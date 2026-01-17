<svelte:options runes={true} />

<script>
	// Animation Inspector - Pause, annotate, and capture animation state for AI
	// Supports multiple annotations: pause at different points, annotate each, then copy all
	import { onMount } from 'svelte';
	import options from 'virtual:svelte-inspector-options';

	// Use dedicated toggle combo for animation inspector (alt-a by default)
	const toggle_combo = options.animationToggleKeyCombo?.toLowerCase().split('-');
	const escape_keys = options.escapeKeys?.map((k) => k.toLowerCase());

	// State
	let enabled = $state(false);
	let paused_animations = $state([]);
	let active_el = $state(null);

	// Multi-annotation support
	let annotations = $state([]); // Array of {state, note, id}
	let current_annotation = $state('');
	let show_quick_input = $state(false);
	let captured_state = $state(null);

	// UI positioning
	let popup_x = $state(0);
	let popup_y = $state(0);

	// Feedback states
	let show_copied_toast = $state(false);
	let annotation_count = $derived(annotations.length);

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
	 * Generate structured output for a single annotation
	 */
	function generate_single_output(state, annotation_text, index) {
		const lines = [];

		if (index !== undefined) {
			lines.push(`### Annotation ${index + 1}`);
			lines.push('');
		}

		if (state.file_loc) {
			lines.push(`**File:** \`${state.file_loc}\``);
		}
		lines.push(
			`**Element:** \`<${state.tagName}>\`${state.id ? ` #${state.id}` : ''}${state.className ? ` .${state.className}` : ''}`
		);
		lines.push('');

		if (annotation_text) {
			lines.push(`**Feedback:** ${annotation_text}`);
			lines.push('');
		}

		if (state.animations.length > 0) {
			lines.push('**Animation State:**');
			for (const anim of state.animations) {
				const progress =
					anim.progress !== undefined ? `${Math.round(anim.progress * 100)}%` : 'N/A';
				lines.push(`- ${anim.name}: ${progress} (${anim.currentTime}ms / ${anim.duration}ms)`);
			}
			lines.push('');
		}

		lines.push('**Computed Styles:**');
		lines.push('```css');
		for (const [key, value] of Object.entries(state.styles)) {
			if (value && value !== 'none' && value !== 'auto' && value !== 'normal') {
				lines.push(`${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`);
			}
		}
		lines.push('```');

		if (state.svg_data?.d) {
			lines.push('');
			lines.push('**SVG Path:**');
			lines.push('```');
			lines.push(`d="${state.svg_data.d}"`);
			lines.push('```');
		}

		return lines.join('\n');
	}

	/**
	 * Generate combined output for all annotations
	 */
	function generate_all_output() {
		const lines = [
			'## Animation Annotations',
			'',
			`*${annotations.length} annotation${annotations.length !== 1 ? 's' : ''} captured during animation inspection*`,
			''
		];

		for (let i = 0; i < annotations.length; i++) {
			const { state, note } = annotations[i];
			lines.push(generate_single_output(state, note, i));
			if (i < annotations.length - 1) {
				lines.push('');
				lines.push('---');
				lines.push('');
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
	 * Handle click - pause and show quick annotation input
	 */
	function handle_click(e) {
		if (!enabled || show_quick_input) return;

		e.preventDefault();
		e.stopPropagation();

		const el = e.target;
		active_el = el;
		pause_animations(el);
		captured_state = capture_element_state(el);

		// Position popup near click
		popup_x = Math.min(e.clientX, window.innerWidth - 320);
		popup_y = Math.min(e.clientY, window.innerHeight - 200);

		show_quick_input = true;
		current_annotation = '';
	}

	/**
	 * Handle right-click - same as click (pause and annotate)
	 */
	function handle_contextmenu(e) {
		if (!enabled) return;
		e.preventDefault();
		handle_click(e);
	}

	/**
	 * Save current annotation and resume
	 */
	function save_annotation() {
		if (!captured_state) return;

		// Add to annotations list
		annotations = [
			...annotations,
			{
				id: Date.now(),
				state: captured_state,
				note: current_annotation || '(no note)'
			}
		];

		// Reset and resume
		show_quick_input = false;
		current_annotation = '';
		resume_animations();
		active_el = null;
		captured_state = null;
	}

	/**
	 * Skip annotation (just resume)
	 */
	function skip_annotation() {
		show_quick_input = false;
		current_annotation = '';
		resume_animations();
		active_el = null;
		captured_state = null;
	}

	/**
	 * Remove an annotation from the list
	 */
	function remove_annotation(id) {
		annotations = annotations.filter((a) => a.id !== id);
	}

	/**
	 * Copy all annotations to clipboard
	 */
	async function copy_all() {
		if (annotations.length === 0) return;

		const output = generate_all_output();
		const copied = await copy_to_clipboard(output);

		if (copied) {
			show_copied_toast = true;
			setTimeout(() => {
				show_copied_toast = false;
			}, 2000);
		}
	}

	/**
	 * Clear all annotations
	 */
	function clear_all() {
		annotations = [];
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
			if (show_quick_input) {
				skip_annotation();
			} else {
				disable();
			}
		} else if (show_quick_input && e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			save_annotation();
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
		show_quick_input = false;
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
>
	{#if annotation_count > 0}
		<span class="badge">{annotation_count}</span>
	{/if}
</button>

<!-- Status Indicator -->
{#if enabled}
	<div id="svelte-animation-inspector-status">
		Animation Inspector Active
		<span class="hint">Click to pause & annotate | Esc: exit</span>
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

<!-- Quick Annotation Input -->
{#if show_quick_input && captured_state}
	<div id="svelte-animation-inspector-quick" style="left: {popup_x}px; top: {popup_y}px;">
		<div class="quick-header">
			<span class="element-tag">&lt;{captured_state.tagName}&gt;</span>
			{#if captured_state.animations.length > 0}
				<span class="anim-progress">
					{Math.round((captured_state.animations[0]?.progress || 0) * 100)}%
				</span>
			{/if}
		</div>

		<input
			type="text"
			class="quick-input"
			bind:value={current_annotation}
			placeholder="What should change here?"
			autofocus
		/>

		<div class="quick-suggestions">
			<button onclick={() => (current_annotation = 'Slower')}>Slower</button>
			<button onclick={() => (current_annotation = 'Faster')}>Faster</button>
			<button onclick={() => (current_annotation = 'More bounce')}>Bounce</button>
			<button onclick={() => (current_annotation = 'Smoother')}>Smooth</button>
		</div>

		<div class="quick-actions">
			<button class="skip-btn" onclick={skip_annotation}>Skip</button>
			<button class="save-btn" onclick={save_annotation}> Save & Resume </button>
		</div>
	</div>
{/if}

<!-- Annotations Panel -->
{#if enabled && annotations.length > 0}
	<div id="svelte-animation-inspector-panel">
		<div class="panel-header">
			<span>{annotation_count} annotation{annotation_count !== 1 ? 's' : ''}</span>
			<button class="clear-btn" onclick={clear_all}>Clear</button>
		</div>

		<div class="panel-list">
			{#each annotations as ann, i (ann.id)}
				<div class="panel-item">
					<div class="item-header">
						<span class="item-num">#{i + 1}</span>
						<span class="item-tag">&lt;{ann.state.tagName}&gt;</span>
						<button class="item-remove" onclick={() => remove_annotation(ann.id)}>×</button>
					</div>
					<div class="item-note">{ann.note}</div>
				</div>
			{/each}
		</div>

		<button class="copy-all-btn" onclick={copy_all}> Copy All for Claude Code </button>
	</div>
{/if}

<!-- Copied Toast -->
{#if show_copied_toast}
	<div id="svelte-animation-inspector-toast">
		Copied {annotation_count} annotation{annotation_count !== 1 ? 's' : ''} to clipboard!
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

	.badge {
		position: absolute;
		top: -6px;
		right: -6px;
		background: #ff3e00;
		color: white;
		font-size: 11px;
		font-weight: 600;
		min-width: 18px;
		height: 18px;
		border-radius: 9px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
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

	/* Quick Annotation Input */
	#svelte-animation-inspector-quick {
		position: fixed;
		width: 280px;
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

	.quick-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 12px;
		background: #f8f8f8;
		border-bottom: 1px solid #eee;
	}

	.element-tag {
		font-size: 13px;
		font-weight: 600;
		color: #333;
	}

	.anim-progress {
		font-size: 12px;
		color: #ff3e00;
		font-weight: 600;
	}

	.quick-input {
		width: 100%;
		padding: 12px;
		border: none;
		border-bottom: 1px solid #eee;
		font-size: 14px;
		font-family: inherit;
	}

	.quick-input:focus {
		outline: none;
		background: #fffaf9;
	}

	.quick-suggestions {
		padding: 8px 12px;
		display: flex;
		gap: 6px;
		border-bottom: 1px solid #eee;
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

	.quick-actions {
		display: flex;
		gap: 8px;
		padding: 10px 12px;
	}

	.skip-btn {
		flex: 1;
		padding: 8px;
		background: white;
		border: 1px solid #ddd;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
	}

	.skip-btn:hover {
		background: #f5f5f5;
	}

	.save-btn {
		flex: 2;
		padding: 8px;
		background: #ff3e00;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.save-btn:hover {
		background: #e63600;
	}

	/* Annotations Panel */
	#svelte-animation-inspector-panel {
		position: fixed;
		bottom: 52px;
		right: 8px;
		width: 260px;
		background: white;
		border-radius: 12px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		z-index: 999998;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 12px;
		background: #f8f8f8;
		border-bottom: 1px solid #eee;
		font-size: 13px;
		font-weight: 600;
		color: #333;
	}

	.clear-btn {
		background: none;
		border: none;
		color: #999;
		font-size: 12px;
		cursor: pointer;
	}

	.clear-btn:hover {
		color: #ff3e00;
	}

	.panel-list {
		max-height: 200px;
		overflow-y: auto;
	}

	.panel-item {
		padding: 8px 12px;
		border-bottom: 1px solid #f0f0f0;
	}

	.panel-item:last-child {
		border-bottom: none;
	}

	.item-header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
	}

	.item-num {
		font-size: 11px;
		color: #ff3e00;
		font-weight: 600;
	}

	.item-tag {
		font-size: 11px;
		color: #666;
	}

	.item-remove {
		margin-left: auto;
		background: none;
		border: none;
		color: #ccc;
		font-size: 16px;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	.item-remove:hover {
		color: #ff3e00;
	}

	.item-note {
		font-size: 12px;
		color: #333;
	}

	.copy-all-btn {
		width: 100%;
		padding: 12px;
		background: #ff3e00;
		color: white;
		border: none;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.copy-all-btn:hover {
		background: #e63600;
	}

	/* Toast */
	#svelte-animation-inspector-toast {
		position: fixed;
		bottom: 60px;
		left: 50%;
		transform: translateX(-50%);
		background: #333;
		color: white;
		padding: 10px 20px;
		border-radius: 20px;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		font-size: 13px;
		z-index: 999999;
		animation: toast-in 0.3s ease;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}
</style>
