<script lang="ts">
  import {onMount} from "svelte";

  import SQLiteAsyncESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
  import SQLiteAsyncWasmUrl from "wa-sqlite/dist/wa-sqlite-async.wasm?url";
  import {Factory as SQLiteFactory} from "wa-sqlite/src/sqlite-api.js";
  import {tag as SQLiteTag} from "wa-sqlite/src/examples/tag.js";

  import {WebTorrentVFS} from "wa-sqlite-webtorrent";
  import type {Instance as WebTorrent} from "webtorrent";

  import type monaco from "monaco-editor";
  import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

  import googDbUrl from "../../static/GOOG.db?url";

  const DEFAULT_SQL = `
-- You can also select single statements to only execute them.
SELECT * FROM goog LIMIT 5;
`.trim();

  let editor: monaco.editor.IStandaloneCodeEditor

  let sqlite3;
  let vfs: WebTorrentVFS;
  let dbId: number;
  let sql;

  let peers: number = 0;
  let button: HTMLButtonElement;
  let timestamp: string = "";
  let output;

  onMount(async () => {
    // Initialize SQLite and Monaco in parallel because both are slow.
    const [SQLiteAsyncModule] = await Promise.all([
      SQLiteAsyncESMFactory({
        locateFile(file) {
          return SQLiteAsyncWasmUrl;
        }
      }),
      setupEditor()
    ]);

    // @ts-ignore
    sqlite3 = SQLiteFactory(SQLiteAsyncModule);

    // @ts-ignore
    const webtorrent: WebTorrent = new window.WebTorrent();

    const webseedUrl = new URL(googDbUrl, document.URL).toString(); // make absolute

    // ws is not used without peers, because meta (piece info) is missing
    // instead we have to use a full torrent file
    const magnetUri = `magnet:?xt=urn:btih:a40d817caba3681fe50022b0dda5fbf5d31f3ca9&dn=GOOG.db&ws=${encodeURIComponent(webseedUrl)}&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com`;

    const b64toBlob = (base64, type = "application/octet-stream") => fetch(`data:${type};base64,${base64}`).then(res => res.blob())
    const torrentBase64 = "ZDg6YW5ub3VuY2U0MDp1ZHA6Ly90cmFja2VyLmxlZWNoZXJzLXBhcmFkaXNlLm9yZzo2OTY5MTM6YW5ub3VuY2UtbGlzdGxsNDA6dWRwOi8vdHJhY2tlci5sZWVjaGVycy1wYXJhZGlzZS5vcmc6Njk2OWVsMzQ6dWRwOi8vdHJhY2tlci5jb3BwZXJzdXJmZXIudGs6Njk2OWVsMzM6dWRwOi8vdHJhY2tlci5vcGVudHJhY2tyLm9yZzoxMzM3ZWwyMzp1ZHA6Ly9leHBsb2RpZS5vcmc6Njk2OWVsMzE6dWRwOi8vdHJhY2tlci5lbXBpcmUtanMudXM6MTMzN2VsMjY6d3NzOi8vdHJhY2tlci5idG9ycmVudC54eXplbDMyOndzczovL3RyYWNrZXIub3BlbndlYnRvcnJlbnQuY29tZWUxMDpjcmVhdGVkIGJ5MzQ6V2ViVG9ycmVudCA8aHR0cHM6Ly93ZWJ0b3JyZW50LmlvPjEzOmNyZWF0aW9uIGRhdGVpMTYyMTc3OTU3N2U4OmVuY29kaW5nNTpVVEYtODQ6aW5mb2Q2Omxlbmd0aGk5NDIwOGU0Om5hbWU3OkdPT0cuZGIxMjpwaWVjZSBsZW5ndGhpMTYzODRlNjpwaWVjZXMxMjA63UmSQ5U1eLDJpHHzQ9cXWV4+ldkUiJV5VCL4UX5xyXgvbFMlW0hxtAosaxG1T5FNTIBwTmyeAXG+kc51XgtE4XFwZ5flrqZ9GZUp1LxOGRxqECW95MIA82jEsuRrjpYxXVvXGpgVpGqhFiLJgYWf797sguFdeQB5Nzpwcml2YXRlaTBlZWU=";
    const torrentBlob = await b64toBlob(torrentBase64);

    // cut off last endmarker & add the dynamic webseed url
    const torrentFile = new Blob([torrentBlob.slice(0, -1), `8:url-listl${webseedUrl.length}:${webseedUrl}ee`], {type: "application/x-bittorrent"});

    const torrent = webtorrent.add(torrentFile as File, (torrent) => {
      torrent.deselect(0, torrent.pieces.length - 1, 0); // disable prefetching
    })
    // Display the current number of peers
    torrent.on("wire", (wire) => {
      peers = torrent.numPeers;
    });

    // Create vfs
    vfs = new WebTorrentVFS(torrent);

    // Register Virtual File Systems with the SQLite runtime.
    sqlite3.vfs_register(vfs, true); // as default vfs

    // Open the database
    dbId = await sqlite3.open_v2("GOOG.db", undefined, 0); // FIXME 0 = use default vfs, because vfs.name currently does not work
    // Create a template tag which allows to run queries like so
    // const result = await sql`SELECT * FROM table`
    sql = SQLiteTag(sqlite3, dbId);

    return () => {
      editor.dispose();
      sqlite3.close();
      vfs.close();
      webtorrent.destroy();
    }
  });

  // https://dev.to/lawrencecchen/monaco-editor-svelte-kit-572
  async function setupEditor() {
    // @ts-ignore
    self.MonacoEnvironment = {
      getWorker: function (moduleId: any, label: string) {
        return new EditorWorker();
      }
    };

    let MonacoModule = await import("monaco-editor");

    // Create editor.
    // https://microsoft.github.io/monaco-editor/api/modules/monaco.editor.html#create
    editor = MonacoModule.editor.create(document.getElementById('editor-container'), {
      language: 'sql',
      minimap: {enabled: false},
      automaticLayout: true
    });

    // Change the button text with selection.
    editor.onDidChangeCursorSelection(({selection}) => {
      button.textContent = selection.isEmpty() ?
        'Execute' :
        'Execute selection';
    });

    // Persist editor content across page loads.
    let change;
    editor.onDidChangeModelContent(() => {
      if (change) {
        clearTimeout(change);
      }
      change = setTimeout(() => {
        localStorage.setItem('wa-sqlite-webtorrent-demo', editor.getValue());
      }, 1000);
    });
    editor.setValue(localStorage.getItem('wa-sqlite-webtorrent-demo') ?? DEFAULT_SQL);
  }

  function formatTable({columns, rows}) {
    const table = document.createElement('table');

    const thead = table.appendChild(document.createElement('thead'));
    thead.appendChild(formatRow(columns, 'th'));

    const tbody = table.appendChild(document.createElement('tbody'));
    for (const row of rows) {
      tbody.appendChild(formatRow(row));
    }

    return table;
  }

  function formatRow(data, tag = 'td') {
    const row = document.createElement('tr');
    for (const value of data) {
      const cell = row.appendChild(document.createElement(tag));
      cell.textContent = value !== null ? value.toString() : 'null';
    }
    return row;
  }

  async function execute(event: Event) {
    button.disabled = true;
    try {
      // Get SQL from editor.
      const selection = editor.getSelection();
      const queries = selection.isEmpty() ?
        editor.getValue() :
        editor.getModel().getValueInRange(selection);

      // Clear any previous output on the page.
      while (output.firstChild) output.removeChild(output.lastChild);

      const start = new Date();
      timestamp = start.toLocaleString();

      // Execute the SQL using the template tag function.
      const results = await sql`${queries}`;

      timestamp += ` | executed ${results.length} statements in ${(Date.now() - start.getTime()) / 1000} seconds`;

      // Everything below this point is just user interface stuff.
      results.map(formatTable).forEach(table => output.append(table));
    } catch (e) {
      // Adjust for browser differences in Error.stack().
      const report = (window['chrome'] ? '' : `${e.message}\n`) + e.stack;
      output.innerHTML = `<pre>${report}</pre>`;
    } finally {
      button.disabled = false;
    }
  }
</script>

<svelte:head>
  <title>wa-sqlite-webtorrent Demo</title>
</svelte:head>

<section>
  <div id="editor-container"></div>
  <div>
    <button bind:this={button} on:click={execute}>Execute</button>
    <span>Peers: {peers}</span>
  </div>
  <div id="timestamp">{timestamp}</div>
  <div id="output" bind:this={output}></div>

  <a href="https://github.com/ydylla/wa-sqlite-webtorrent" class="github-corner" aria-label="View source on GitHub">
    <svg width="80" height="80" viewBox="0 0 250 250"
         style="fill:#151513; color:#fff; position: absolute; top: 0; border: 0; right: 0;" aria-hidden="true">
      <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
      <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path>
      <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path>
    </svg>
  </a>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex: 1;
  }

  #editor-container {
    width: 100%;
    height: 50vh;
  }

  #timestamp {
    margin-top: 0.5em;
  }

  #output {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    width: 100%;
  }

  :global(table) {
      margin-top: 1em;
      margin-left: 0.4em;
      margin-right: 0.4em;
      border-collapse: collapse;
  }

  :global(td, th) {
      border: 1px solid #999;
      padding: 0.5rem;
      text-align: left;
  }

  .github-corner:hover .octo-arm {
    animation: octocat-wave 560ms ease-in-out
  }

  @keyframes octocat-wave {
    0%, 100% {
      transform: rotate(0)
    }
    20%, 60% {
      transform: rotate(-25deg)
    }
    40%, 80% {
      transform: rotate(10deg)
    }
  }

  @media (max-width: 500px) {
    .github-corner:hover .octo-arm {
      animation: none
    }

    .github-corner .octo-arm {
      animation: octocat-wave 560ms ease-in-out
    }
  }
</style>
