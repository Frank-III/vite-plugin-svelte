<svelte:options runes={true} />

<script>
	// Animation Inspector - Pause, annotate, and capture animation state for AI
	import { onMount } from 'svelte';
	import options from 'virtual:svelte-inspector-options';

	// Use dedicated toggle combo for animation inspector (alt-a by default)
	const toggle_combo = options.animationToggleKeyCombo?.toLowerCase().split('-');
	const escape_keys = options.escapeKeys?.map((k) => k.toLowerCase());

	// State
	let enabled = $state(false);
	let paused_animations = $state([]);
	let active_el = $state(null);
	let show_popup = $state(false);
	let annotation = $state('');
	let captured_state = $state(null);

	// Mouse position for popup
	let popup_x = $state(0);
	let popup_y = $state(0);

	// Icon for the toggle button (film/animation themed)
	const icon = `data:image/svg+xml;base64,${btoa(
		`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff3e00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
			<line x1="7" y1="2" x2="7" y2="22"></line>
			<line x1="17" y1="2" x2="17" y2="22"></line>
			<line x1="2" y1="12" x2="22" y2="12"></line>
			<line x1="2" y1="7" x2="7" y2="7"></line>
			<line x1="2" y1="17" x2="7" y2="17"></line>
			<line x1="17" y1="7" x2="22" y2="7"></line>
			<line x1="17" y1="17" x2="22" y2="17"></line>
		</svg>`
			.replace(/[\n\r\t]+/g, ' ')
			.trim()
	)}`;

	/**
	 * Get all animations on an element and its descendants
	 */
	function get_element_animations(el) {
		if (!el) return [];
		const animations = el.getAnimations ? el.getAnimations() : [];
		// Also get animations from descendants
		const descendants = el.querySelectorAll('*');
		for (const desc of descendants) {
			if (desc.getAnimations) {
				animations.push(...desc.getAnimations());
			}
		}
		return animations;
	}

	/**
	 * Get all running animations in the document
	 */
	function get_all_animations() {
		return document.getAnimations ? document.getAnimations() : [];
	}

	/**
	 * Pause all animations on an element
	 */
	function pause_animations(el) {
		const animations = el ? get_element_animations(el) : get_all_animations();
		const paused = [];
		for (const anim of animations) {
			if (anim.playState === 'running') {
				anim.pause();
				paused.push(anim);
			}
		}
		paused_animations = paused;
		return paused;
	}

	/**
	 * Resume all paused animations
	 */
	function resume_animations() {
		for (const anim of paused_animations) {
			anim.play();
		}
		paused_animations = [];
	}

	/**
	 * Capture the current state of an element
	 */
	function capture_element_state(el) {
		if (!el) return null;

		const computed = getComputedStyle(el);
		const rect = el.getBoundingClientRect();
		const animations = get_element_animations(el);

		// Get Svelte source location if available
		const svelte_meta = el.__svelte_meta?.loc;
		const file_loc = svelte_meta
			? `${svelte_meta.file}:${svelte_meta.line + 1}:${svelte_meta.column + 1}`
			: null;

		// Capture animation-relevant styles
		const animation_state = {
			// Transform properties
			transform: computed.transform,
			opacity: computed.opacity,

			// Position/size
			width: computed.width,
			height: computed.height,
			top: computed.top,
			left: computed.left,

			// Colors
			backgroundColor: computed.backgroundColor,
			color: computed.color,
			borderColor: computed.borderColor,

			// SVG-specific
			fill: computed.fill,
			stroke: computed.stroke,
			strokeDasharray: computed.strokeDasharray,
			strokeDashoffset: computed.strokeDashoffset,

			// Visibility
			visibility: computed.visibility,
			display: computed.display
		};

		// Capture animation timing info
		const animation_info = animations.map((anim) => {
			const timing = anim.effect?.getComputedTiming?.() || {};
			return {
				name: anim.animationName || anim.id || 'unnamed',
				currentTime: anim.currentTime,
				duration: timing.duration,
				progress: timing.progress,
				phase: timing.phase, // 'before', 'active', 'after'
				playState: anim.playState,
				easing: timing.easing
			};
		});

		// For SVG elements, capture path data
		let svg_data = null;
		if (el.tagName === 'path' || el.tagName === 'PATH') {
			svg_data = {
				d: el.getAttribute('d')
			};
		} else if (el.tagName === 'svg' || el.tagName === 'SVG') {
			svg_data = {
				innerHTML: el.innerHTML
			};
		}

		return {
			tagName: el.tagName.toLowerCase(),
			id: el.id || null,
			className: el.className || null,
			file_loc,
			rect: {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height
			},
			styles: animation_state,
			animations: animation_info,
			svg_data,
			timestamp: Date.now()
		};
	}

	/**
	 * Generate structured output for Claude Code
	 */
	function generate_output(state, annotation_text) {
		const lines = ['## Animation Annotation', ''];

		if (state.file_loc) {
			lines.push(`**File:** \`${state.file_loc}\``);
		}
		lines.push(
			`**Element:** \`<${state.tagName}>\`${state.id ? ` #${state.id}` : ''}${state.className ? ` .${state.className}` : ''}`
		);
		lines.push('');

		if (annotation_text) {
			lines.push('### Feedback');
			lines.push(annotation_text);
			lines.push('');
		}

		lines.push('### Current Animation State');

		if (state.animations.length > 0) {
			for (const anim of state.animations) {
				lines.push(
					`- **${anim.name}**: ${anim.progress !== undefined ? `${Math.round(anim.progress * 100)}%` : 'N/A'} through animation`
				);
				lines.push(`  - Current time: ${anim.currentTime}ms / ${anim.duration}ms`);
				lines.push(`  - Phase: ${anim.phase}`);
				lines.push(`  - Easing: ${anim.easing}`);
			}
		} else {
			lines.push('- No active animations detected (may be CSS transition or JS-driven)');
		}
		lines.push('');

		lines.push('### Computed Styles at This Moment');
		lines.push('```css');
		for (const [key, value] of Object.entries(state.styles)) {
			if (value && value !== 'none' && value !== 'auto' && value !== 'normal') {
				lines.push(`${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`);
			}
		}
		lines.push('```');
		lines.push('');

		if (state.svg_data) {
			lines.push('### SVG Data');
			if (state.svg_data.d) {
				lines.push('```');
				lines.push(`d="${state.svg_data.d}"`);
				lines.push('```');
			}
		}

		return lines.join('\n');
	}

	/**
	 * Copy text to clipboard
	 */
	async function copy_to_clipboard(text) {
		try {
			// eslint-disable-next-line n/no-unsupported-features/node-builtins -- browser API
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Handle right-click - pause only
	 */
	function handle_contextmenu(e) {
		if (!enabled) return;

		e.preventDefault();
		e.stopPropagation();

		const el = e.target;
		active_el = el;
		pause_animations(el);
		captured_state = capture_element_state(el);
	}

	/**
	 * Handle left-click - pause and show annotation popup
	 */
	function handle_click(e) {
		if (!enabled) return;

		e.preventDefault();
		e.stopPropagation();

		const el = e.target;
		active_el = el;
		pause_animations(el);
		captured_state = capture_element_state(el);

		// Position popup near click
		popup_x = Math.min(e.clientX, window.innerWidth - 320);
		popup_y = Math.min(e.clientY, window.innerHeight - 250);

		show_popup = true;
		annotation = '';
	}

	/**
	 * Submit annotation and copy to clipboard
	 */
	async function submit_annotation() {
		if (!captured_state) return;

		const output = generate_output(captured_state, annotation);
		const copied = await copy_to_clipboard(output);

		if (copied) {
			// Show brief success feedback
			show_popup = false;
			annotation = '';
		}

		// Resume animations after copying
		resume_animations();
		active_el = null;
		captured_state = null;
	}

	/**
	 * Cancel annotation
	 */
	function cancel_annotation() {
		show_popup = false;
		annotation = '';
		resume_animations();
		active_el = null;
		captured_state = null;
	}

	// Key detection helpers (same as main inspector)
	function is_active(key, e) {
		switch (key) {
			case 'shift':
			case 'control':
			case 'alt':
			case 'meta':
				return e.getModifierState(key.charAt(0).toUpperCase() + key.slice(1));
			default:
				return key === e.code.replace(/^Key/, '').toLowerCase() || key === e.key.toLowerCase();
		}
	}

	function is_combo(e) {
		return toggle_combo?.every((k) => is_active(k, e));
	}

	function is_escape(e) {
		return escape_keys?.some((k) => is_active(k, e));
	}

	function keydown(e) {
		if (e.repeat || e.key == null) return;

		if (is_combo(e)) {
			e.preventDefault();
			toggle();
		} else if (enabled && is_escape(e)) {
			disable();
		}
	}

	function toggle() {
		if (enabled) {
			disable();
		} else {
			enable();
		}
	}

	function enable() {
		enabled = true;
		document.body.classList.add('svelte-animation-inspector-enabled');
		document.body.addEventListener('click', handle_click, true);
		document.body.addEventListener('contextmenu', handle_contextmenu, true);
	}

	function disable() {
		enabled = false;
		show_popup = false;
		resume_animations();
		active_el = null;
		captured_state = null;
		document.body.classList.remove('svelte-animation-inspector-enabled');
		document.body.removeEventListener('click', handle_click, true);
		document.body.removeEventListener('contextmenu', handle_contextmenu, true);
	}

	onMount(() => {
		document.body.addEventListener('keydown', keydown);

		return () => {
			disable();
			document.body.removeEventListener('keydown', keydown);
		};
	});
</script>

<!-- Toggle Button -->
<button
	id="svelte-animation-inspector-toggle"
	class:enabled
	style="background-image: url({icon});"
	onclick={() => toggle()}
	aria-label={`${enabled ? 'disable' : 'enable'} animation inspector`}
></button>

<!-- Status Indicator -->
{#if enabled}
	<div id="svelte-animation-inspector-status">
		🎬 Animation Inspector Active
		<span class="hint">Left-click: annotate | Right-click: pause only | Esc: exit</span>
	</div>
{/if}

<!-- Active Element Highlight -->
{#if enabled && active_el}
	{@const rect = active_el.getBoundingClientRect()}
	<div
		id="svelte-animation-inspector-highlight"
		style="
			left: {rect.left - 2}px;
			top: {rect.top - 2}px;
			width: {rect.width + 4}px;
			height: {rect.height + 4}px;
		"
	></div>
{/if}

<!-- Annotation Popup -->
{#if show_popup && captured_state}
	<div id="svelte-animation-inspector-popup" style="left: {popup_x}px; top: {popup_y}px;">
		<div class="popup-header">
			<span class="element-info">
				&lt;{captured_state.tagName}&gt;
				{#if captured_state.file_loc}
					<span class="file-loc">{captured_state.file_loc}</span>
				{/if}
			</span>
			<button class="close-btn" onclick={cancel_annotation}>×</button>
		</div>

		{#if captured_state.animations.length > 0}
			<div class="animation-info">
				{#each captured_state.animations as anim, i (i)}
					<div class="anim-item">
						<strong>{anim.name}</strong>: {anim.progress !== undefined
							? `${Math.round(anim.progress * 100)}%`
							: 'N/A'}
					</div>
				{/each}
			</div>
		{/if}

		<div class="annotation-section">
			<label for="annotation-input">What should change?</label>
			<textarea
				id="annotation-input"
				bind:value={annotation}
				placeholder="e.g., 'Make this slower', 'More bounce at the end', 'Fade should start earlier'"
				rows="3"
			></textarea>
		</div>

		<div class="quick-suggestions">
			<button onclick={() => (annotation = 'Make this slower')}>Slower</button>
			<button onclick={() => (annotation = 'Make this faster')}>Faster</button>
			<button onclick={() => (annotation = 'Add more bounce/spring')}>Bouncier</button>
			<button onclick={() => (annotation = 'Make this smoother')}>Smoother</button>
			<button onclick={() => (annotation = 'Increase delay before starting')}>More delay</button>
		</div>

		<div class="popup-actions">
			<button class="cancel-btn" onclick={cancel_annotation}>Cancel</button>
			<button class="submit-btn" onclick={submit_annotation}> Copy for Claude Code </button>
		</div>
	</div>
{/if}

<style>
	:global(body.svelte-animation-inspector-enabled) {
		cursor: crosshair !important;
	}

	:global(body.svelte-animation-inspector-enabled *) {
		cursor: crosshair !important;
	}

	#svelte-animation-inspector-toggle {
		all: unset;
		position: fixed;
		bottom: 8px;
		right: 8px;
		width: 36px;
		height: 36px;
		background-color: white;
		background-position: center;
		background-repeat: no-repeat;
		background-size: 24px;
		border: 2px solid #ff3e00;
		border-radius: 8px;
		cursor: pointer;
		z-index: 999998;
		transition: all 0.2s ease;
	}

	#svelte-animation-inspector-toggle:not(.enabled) {
		filter: grayscale(1);
		opacity: 0.6;
	}

	#svelte-animation-inspector-toggle:hover {
		background-color: #fff0ed;
		transform: scale(1.05);
	}

	#svelte-animation-inspector-toggle.enabled {
		box-shadow: 0 0 0 3px rgba(255, 62, 0, 0.3);
	}

	#svelte-animation-inspector-status {
		position: fixed;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		background: linear-gradient(135deg, #ff3e00 0%, #ff6b35 100%);
		color: white;
		padding: 8px 16px;
		border-radius: 20px;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		font-size: 14px;
		font-weight: 500;
		z-index: 999999;
		box-shadow: 0 4px 12px rgba(255, 62, 0, 0.3);
	}

	#svelte-animation-inspector-status .hint {
		display: block;
		font-size: 11px;
		opacity: 0.9;
		margin-top: 2px;
	}

	#svelte-animation-inspector-highlight {
		position: fixed;
		border: 2px dashed #ff3e00;
		background: rgba(255, 62, 0, 0.1);
		pointer-events: none;
		z-index: 999997;
		border-radius: 4px;
	}

	#svelte-animation-inspector-popup {
		position: fixed;
		width: 300px;
		background: white;
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
		z-index: 999999;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		overflow: hidden;
	}

	.popup-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 12px;
		background: #f8f8f8;
		border-bottom: 1px solid #eee;
	}

	.element-info {
		font-size: 13px;
		font-weight: 600;
		color: #333;
	}

	.file-loc {
		display: block;
		font-size: 11px;
		font-weight: normal;
		color: #666;
		margin-top: 2px;
		word-break: break-all;
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 20px;
		color: #999;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	.close-btn:hover {
		color: #333;
	}

	.animation-info {
		padding: 8px 12px;
		background: #fff8f6;
		border-bottom: 1px solid #ffe5df;
	}

	.anim-item {
		font-size: 12px;
		color: #ff3e00;
	}

	.annotation-section {
		padding: 12px;
	}

	.annotation-section label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #333;
		margin-bottom: 6px;
	}

	.annotation-section textarea {
		width: 100%;
		padding: 8px;
		border: 1px solid #ddd;
		border-radius: 6px;
		font-size: 13px;
		resize: none;
		font-family: inherit;
	}

	.annotation-section textarea:focus {
		outline: none;
		border-color: #ff3e00;
		box-shadow: 0 0 0 2px rgba(255, 62, 0, 0.1);
	}

	.quick-suggestions {
		padding: 0 12px 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.quick-suggestions button {
		background: #f0f0f0;
		border: none;
		padding: 4px 10px;
		border-radius: 12px;
		font-size: 11px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.quick-suggestions button:hover {
		background: #ff3e00;
		color: white;
	}

	.popup-actions {
		display: flex;
		gap: 8px;
		padding: 12px;
		background: #f8f8f8;
		border-top: 1px solid #eee;
	}

	.cancel-btn {
		flex: 1;
		padding: 8px;
		background: white;
		border: 1px solid #ddd;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
	}

	.cancel-btn:hover {
		background: #f5f5f5;
	}

	.submit-btn {
		flex: 2;
		padding: 8px;
		background: #ff3e00;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.submit-btn:hover {
		background: #e63600;
	}
</style>
