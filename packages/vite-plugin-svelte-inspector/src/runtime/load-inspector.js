// eslint-disable-next-line n/no-missing-import
import Inspector from 'virtual:svelte-inspector-path:Inspector.svelte';
// eslint-disable-next-line n/no-missing-import
import AnimationInspector from 'virtual:svelte-inspector-path:AnimationInspector.svelte';
import { mount } from 'svelte';

/** @param {string} id */
function create_host(id) {
	if (document.getElementById(id) != null) {
		throw new Error(`${id} element already exists`);
	}
	const el = document.createElement('div');
	el.setAttribute('id', id);
	document.documentElement.appendChild(el);
	return el;
}

mount(Inspector, { target: create_host('svelte-inspector-host') });
mount(AnimationInspector, { target: create_host('svelte-animation-inspector-host') });
