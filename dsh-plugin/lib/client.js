/**
 * @forge3d/dsh-plugin — client half (browser bundle).
 *
 * Contract: `window.__ModuleLoader__.load({ id, factory })` — executing this
 * file only registers the factory; every side effect runs at materialization.
 * No `import`/`export` statements, no top-level await, no Node builtins;
 * `require("react")` comes from the shell baseline.
 *
 * Phase 1: contribute one `conversation.view` tab that frames the app served by
 * the host half at `/forge3d/`. Same origin, so the DSH auth cookie and the
 * `/forge3d/api` proxy both apply; the canvas itself is untouched Vue code.
 */
window.__ModuleLoader__.load({
	id: '@forge3d/dsh-plugin',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		var React = require('react');

		var APP_URL = '/forge3d/';

		/**
		 * The canvas tab. Full-height frame; the app owns everything inside it.
		 * @param {{ sessionId?: string }} props
		 */
		function ForgeCanvasView(props) {
			var sessionId = props && props.sessionId;
			// One iframe per tab instance; sessionId rides along so the app can scope
			// its own state once the offline phase lands.
			// `embed` hides the app's own copilot panel: inside the harness the
			// conversation that drives the canvas is the harness's, so the in-app
			// one is a second agent competing for the same job.
			var src = APP_URL + '?embed' + (sessionId ? '&dshSession=' + encodeURIComponent(sessionId) : '');
			return React.createElement('iframe', {
				title: 'Forge3D canvas',
				src: src,
				style: {
					display: 'block',
					width: '100%',
					height: '100%',
					border: '0',
					background: 'transparent',
					colorScheme: 'normal',
				},
			});
		}

		/**
		 * Cordis entry. `slots` is the only hard dependency: the tab is the whole
		 * feature in this phase.
		 * @param {any} ctx
		 */
		function apply(ctx) {
			ctx.slots.inject('conversation.view', function () {
				return ctx.slots.register(
					{
						name: 'conversation.view',
						id: 'forge3d',
						order: 20,
						label: function () {
							return 'Canvas';
						},
					},
					ForgeCanvasView,
				);
			});
		}

		exports.apply = apply;
		exports.inject = ['slots'];
		// Exported for offline probes only; DSH reads `apply`/`inject`.
		exports.ForgeCanvasView = ForgeCanvasView;
		return module.exports;
	},
});
