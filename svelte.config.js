import preprocess from 'svelte-preprocess';
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://github.com/sveltejs/svelte-preprocess
	// for more information about preprocessors
	preprocess: preprocess(),

	kit: {
		// hydrate the <div id="svelte"> element in src/app.html
		target: '#svelte',
		ssr: false,
		prerender: {
			enabled: true, // enabled because https://github.com/sveltejs/kit/issues/1588
			crawl: false,
			pages: []
		},
		adapter: adapter({
			fallback: "index.html"
		})
	}
};

export default config;
