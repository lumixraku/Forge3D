import { Fragment } from 'react'
import { nextTick, onBeforeUnmount, onMounted, state, watch, onUnmounted, useSetup, cx } from '../store'
import { createGraphHost } from '../litegraph-canvas';
import { createModelThumbnail } from '../model-thumbnail';
import { apiUrl } from '../api'

const SPEC = { props: ["nodes","edges","wireTies","nodeRuns","missingParameters","theme","canvasMode","frameDrawRect","sectionRunning"], emits: ["update:nodes","update:edges","update:wire-ties","update-parameter","update-uploads","update-output","clear-upload","update-name","drag-start","drag-stop","selection-start","selection-end","connect-start","connect-end","node-context-menu","frame-context-menu","pane-context-menu","pane-click","edge-click","preview-image","run-node","run-downstream","stop-run","open-model-editor","run-section","viewport"], defaults: { "wireTies": (() => [])(), "nodeRuns": (() => ({}))(), "missingParameters": (() => ({}))(), "theme": 'dark', "canvasMode": 'select', "frameDrawRect": null, "sectionRunning": () => false } }

export default function LiteGraphCanvas(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    const root = state(null);
    const canvasEl = state(null);
    const mapEl = state(null);
    const viewport = state({
      x: 0,
      y: 0,
      zoom: 1
    });
    const frameButton = state(null);
    const nodeActions = state([]);
    const uploadWells = state([]);
    const hoveredNodeId = state(null);
    const textFields = state([]);
    const renameField = state(null);
    const renameDraft = state('');
    const renameInput = state(null);
    const fileInput = state(null);
    let uploadNodeId = '';
    let host = null;
    let observer = null;
    const consumedAssets = new WeakSet();
    function refreshFrameButton() {
      frameButton.value = host?.selectedFrameButton() || null;
      nodeActions.value = host?.actionChrome() || [];
      uploadWells.value = host?.uploadWells() || [];
      textFields.value = host?.textFields() || [];
      renameField.value = host?.renameField() || null;
    }
    function commitRename() {
      const field = renameField.value;
      if (!field) return;
      const name = renameDraft.value.trim();
      const previous = field.value;
      const id = field.id;
      host?.closeRename();
      if (name && name !== previous) emit('update-name', {
        id,
        name
      });
    }
    function cancelRename() {
      host?.closeRename();
    }
    function onUploadWellDrop(event, well) {
      const file = event.dataTransfer?.files?.[0];
      if (file) uploadAsset(well.nodeId, file);
    }
    
    // Icon actions only show while the pointer is over their node. The listener
    // sits on the root so hovering the overlay buttons themselves still counts.
    function onRootPointerMove(event) {
      hoveredNodeId.value = host?.nodeIdAt({
        x: event.clientX,
        y: event.clientY
      }) || null;
    }
    function onNodeAction(action) {
      host?.runNodeAction(action.nodeId, action.id);
    }
    onMounted(() => {
      host = createGraphHost(canvasEl.value, {
        onNodes: nodes => {
          emit('update:nodes', nodes);
          queueMicrotask(refreshFrameButton);
        },
        onEdges: edges => emit('update:edges', edges),
        onParameter: (id, key, value) => emit('update-parameter', {
          id,
          key,
          value
        }),
        onName: (id, name) => emit('update-name', {
          id,
          name
        }),
        onUpload: id => {
          uploadNodeId = id;
          fileInput.value?.click();
        },
        onClearUpload: id => emit('clear-upload', id),
        onOutput: (id, generatedAssets) => emit('update-output', {
          id,
          generatedAssets
        }),
        onRun: id => emit('run-node', id),
        onRunDownstream: id => emit('run-downstream', id),
        onStop: () => emit('stop-run'),
        onOpenModel: id => emit('open-model-editor', id),
        onPreview: preview => emit('preview-image', preview),
        onDragStart: () => emit('drag-start'),
        onDragStop: payload => emit('drag-stop', payload),
        onSelectionStart: () => emit('selection-start'),
        onSelectionEnd: () => emit('selection-end'),
        onConnectStart: nodeId => emit('connect-start', nodeId),
        onConnectEnd: payload => emit('connect-end', payload),
        onNodeContextMenu: payload => emit('node-context-menu', payload),
        onFrameContextMenu: payload => emit('frame-context-menu', payload),
        onPaneContextMenu: event => emit('pane-context-menu', event),
        onPaneClick: () => emit('pane-click'),
        onEdgeClick: payload => emit('edge-click', payload),
        onViewport: next => {
          viewport.value = next;
          emit('viewport', next);
          refreshFrameButton();
        },
        onTies: ties => emit('update:wire-ties', ties)
      });
      host.setTheme(props.theme);
      host.setMode(props.canvasMode);
      host.sync(props.nodes, props.edges, props.nodeRuns, props.missingParameters);
      // After sync: the routes need the graph's links, which sync builds.
      host.setTies(props.wireTies);
      refreshFrameButton();
      observer = new ResizeObserver(() => {
        host?.resize();
        drawMinimap();
      });
      observer.observe(root.value);
      scanUploads();
      drawMinimap();
    });
    onBeforeUnmount(() => {
      observer?.disconnect();
      host?.destroy();
      host = null;
    });
    watch(() => [props.nodes, props.edges, props.nodeRuns, props.missingParameters], () => {
      host?.sync(props.nodes, props.edges, props.nodeRuns, props.missingParameters);
      refreshFrameButton();
      scanUploads();
    }, {
      deep: true
    });
    watch(() => renameField.value?.id, async id => {
      if (!id) return;
      renameDraft.value = renameField.value.value;
      await nextTick();
      const input = renameInput.value;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
    watch(() => props.theme, theme => {
      host?.setTheme(theme);
      drawMinimap();
    });
    watch(() => props.canvasMode, mode => host?.setMode(mode));
    watch(() => props.wireTies, ties => host?.setTies(ties), {
      deep: true
    });
    watch(viewport, drawMinimap, {
      deep: true
    });
    watch(() => props.nodes, drawMinimap, {
      deep: true
    });
    const MAP_WIDTH = 220;
    const MAP_HEIGHT = 140;
    let mapLayout = null;
    let mapDragging = false;
    function absoluteOrigin(node, byId) {
      let x = node.position?.x || 0;
      let y = node.position?.y || 0;
      let parentId = node.parentNode;
      const seen = new Set();
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        x += parent.position?.x || 0;
        y += parent.position?.y || 0;
        parentId = parent.parentNode;
      }
      return {
        x,
        y
      };
    }
    function minimapBoxes() {
      const byId = new Map(props.nodes.map(node => [node.id, node]));
      return props.nodes.flatMap(node => {
        const loose = node.type !== 'frame' && !node.parentNode;
        if (node.type !== 'frame' && !loose) return [];
        const origin = absoluteOrigin(node, byId);
        const width = Number(node.dimensions?.width || node.width || (node.type === 'frame' ? 900 : 250));
        const height = Number(node.dimensions?.height || node.height || (node.type === 'frame' ? 600 : 180));
        return [{
          id: node.id,
          x: origin.x,
          y: origin.y,
          width,
          height,
          frame: node.type === 'frame',
          selected: Boolean(node.selected)
        }];
      });
    }
    function drawMinimap() {
      const map = mapEl.value;
      const panel = root.value;
      if (!map || !panel) return;
      const boxes = minimapBoxes();
      const ratio = window.devicePixelRatio || 1;
      if (map.width !== Math.round(MAP_WIDTH * ratio) || map.height !== Math.round(MAP_HEIGHT * ratio)) {
        map.width = Math.round(MAP_WIDTH * ratio);
        map.height = Math.round(MAP_HEIGHT * ratio);
      }
      const ctx = map.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const style = getComputedStyle(panel);
      const acid = style.getPropertyValue('--acid').trim() || '#19b8aa';
      const card = style.getPropertyValue('--bg-card').trim() || '#ffffff';
      const line = style.getPropertyValue('--line-strong').trim() || '#cbd1cd';
      ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
      ctx.fillStyle = card;
      ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
      if (!boxes.length) {
        mapLayout = null;
        return;
      }
      const left = Math.min(...boxes.map(box => box.x));
      const top = Math.min(...boxes.map(box => box.y));
      const right = Math.max(...boxes.map(box => box.x + box.width));
      const bottom = Math.max(...boxes.map(box => box.y + box.height));
      const pad = 10;
      const spanX = Math.max(1, right - left);
      const spanY = Math.max(1, bottom - top);
      const scale = Math.min((MAP_WIDTH - pad * 2) / spanX, (MAP_HEIGHT - pad * 2) / spanY);
      const ox = pad + (MAP_WIDTH - pad * 2 - spanX * scale) / 2;
      const oy = pad + (MAP_HEIGHT - pad * 2 - spanY * scale) / 2;
      mapLayout = {
        left,
        top,
        scale,
        ox,
        oy
      };
      for (const box of boxes) {
        const x = ox + (box.x - left) * scale;
        const y = oy + (box.y - top) * scale;
        const width = Math.max(1, box.width * scale);
        const height = Math.max(1, box.height * scale);
        ctx.fillStyle = box.frame ? 'rgba(25, 184, 170, 0.35)' : 'rgba(60, 74, 82, 0.7)';
        ctx.fillRect(x, y, width, height);
        if (box.selected) {
          ctx.strokeStyle = acid;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 0.5, y - 0.5, width + 1, height + 1);
        }
      }
      const zoom = viewport.value.zoom || 1;
      const viewX = ox + (-viewport.value.x / zoom - left) * scale;
      const viewY = oy + (-viewport.value.y / zoom - top) * scale;
      const viewW = panel.clientWidth / zoom * scale;
      const viewH = panel.clientHeight / zoom * scale;
      ctx.fillStyle = 'rgba(25, 184, 170, 0.16)';
      ctx.fillRect(viewX, viewY, viewW, viewH);
      ctx.strokeStyle = acid;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(viewX, viewY, viewW, viewH);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, MAP_WIDTH - 1, MAP_HEIGHT - 1);
    }
    function graphPointFromMap(event) {
      if (!mapLayout || !mapEl.value) return null;
      const rect = mapEl.value.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return {
        x: mapLayout.left + (x - mapLayout.ox) / mapLayout.scale,
        y: mapLayout.top + (y - mapLayout.oy) / mapLayout.scale
      };
    }
    function moveViewFromMap(event) {
      const point = graphPointFromMap(event);
      if (point) host?.centerOn(point.x, point.y);
    }
    function onMapPointerDown(event) {
      event.stopPropagation();
      event.preventDefault();
      mapDragging = true;
      mapEl.value?.setPointerCapture(event.pointerId);
      moveViewFromMap(event);
    }
    function onMapPointerMove(event) {
      if (!mapDragging) return;
      event.stopPropagation();
      moveViewFromMap(event);
    }
    function onMapPointerUp(event) {
      if (!mapDragging) return;
      mapDragging = false;
      event.stopPropagation();
    }
    function fitView(options) {
      host?.fitView(options);
    }
    function screenToFlowCoordinate(point) {
      return host?.screenToFlowCoordinate(point) || {
        x: 0,
        y: 0
      };
    }
    function findNode(id) {
      return host?.findNode(id) || null;
    }
    function scanUploads() {
      for (const node of props.nodes) {
        const file = node.data?.initialAsset;
        if (file instanceof File && !consumedAssets.has(file)) {
          consumedAssets.add(file);
          uploadAsset(node.id, file);
        }
      }
    }
    function onFilePicked(event) {
      const input = event.target;
      const [file] = [...(input.files || [])];
      input.value = '';
      if (file && uploadNodeId) uploadAsset(uploadNodeId, file);
    }
    async function uploadAsset(id, file) {
      const node = props.nodes.find(item => item.id === id);
      const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const modelExtensions = new Set(['glb', 'gltf', 'fbx', 'usdz', 'obj', 'stl', '3mf']);
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const isImage = allowedTypes.has(file.type) || /\.(jpe?g|png|webp)$/i.test(extension);
      const isModel = modelExtensions.has(extension);
      if (!isImage && !isModel || file.size > 100 * 1024 * 1024) return;
      const response = await fetch(apiUrl('/api/assets'), {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': file.name
        },
        body: file
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.url !== 'string') return;
      let thumbnailUrl = '';
      if (isModel && ['glb', 'gltf'].includes(extension)) {
        try {
          const thumbnail = await createModelThumbnail(file);
          const thumbnailResponse = await fetch(apiUrl('/api/assets'), {
            method: 'POST',
            headers: {
              'content-type': 'image/png',
              'x-file-name': `${file.name}.thumbnail.png`
            },
            body: thumbnail
          });
          const thumbnailResult = await thumbnailResponse.json().catch(() => null);
          if (thumbnailResponse.ok && typeof thumbnailResult?.url === 'string') thumbnailUrl = thumbnailResult.url;
        } catch {
          // The model is still usable when the thumbnail render fails.
        }
      }
      const current = node?.data?.uploadAssets || {};
      emit('update-uploads', {
        id,
        uploadAssets: {
          ...current,
          reference: file.name,
          assetType: isModel ? 'model' : 'image',
          assetUrl: result.url,
          ...(isModel ? {
            modelUrl: result.url,
            ...(thumbnailUrl ? {
              thumbnailUrl
            } : {})
          } : {})
        }
      });
    }
    onMounted(() => props.expose?.({
      fitView,
      screenToFlowCoordinate,
      findNode,
      viewport
    }))
    onUnmounted(() => props.expose?.(null))
    return {
      createGraphHost,
      createModelThumbnail,
      root,
      canvasEl,
      mapEl,
      viewport,
      frameButton,
      nodeActions,
      uploadWells,
      hoveredNodeId,
      textFields,
      renameField,
      renameDraft,
      renameInput,
      fileInput,
      get uploadNodeId() { return uploadNodeId }, set uploadNodeId(v) { uploadNodeId = v },
      get host() { return host }, set host(v) { host = v },
      get observer() { return observer }, set observer(v) { observer = v },
      consumedAssets,
      refreshFrameButton,
      commitRename,
      cancelRename,
      onUploadWellDrop,
      onRootPointerMove,
      onNodeAction,
      MAP_WIDTH,
      MAP_HEIGHT,
      get mapLayout() { return mapLayout }, set mapLayout(v) { mapLayout = v },
      get mapDragging() { return mapDragging }, set mapDragging(v) { mapDragging = v },
      absoluteOrigin,
      minimapBoxes,
      drawMinimap,
      graphPointFromMap,
      moveViewFromMap,
      onMapPointerDown,
      onMapPointerMove,
      onMapPointerUp,
      fitView,
      screenToFlowCoordinate,
      findNode,
      scanUploads,
      onFilePicked,
      uploadAsset
    }
  })
  return (
    <div {...vm.$attrs} ref={vm.$ref("root")} onPointerMove={($event: any) => { vm.onRootPointerMove($event) }} onPointerLeave={($event: any) => { vm.hoveredNodeId = null; }} className={cx("forge3d-litegraph forge3d-flow-canvas", `forge3d-canvas-mode-${vm.canvasMode}`, vm.$attrs.className)} style={vm.$attrs.style}><canvas ref={vm.$ref("canvasEl")} className={"forge3d-litegraph-surface"} />
{(vm.frameDrawRect) ? (<div className={"forge3d-frame-draw-layer"} style={{
  transform: `translate(${vm.viewport.x}px, ${vm.viewport.y}px) scale(${vm.viewport.zoom})`
}}><div className={"forge3d-frame-draw-rect"} style={{
  left: `${vm.frameDrawRect.left}px`,
  top: `${vm.frameDrawRect.top}px`,
  width: `${vm.frameDrawRect.right - vm.frameDrawRect.left}px`,
  height: `${vm.frameDrawRect.bottom - vm.frameDrawRect.top}px`,
  borderWidth: `${1 / vm.viewport.zoom}px`,
  borderRadius: `${15 / vm.viewport.zoom}px`
}}><span className={"forge3d-frame-draw-size"} style={{
  transform: `translateY(${-6 / vm.viewport.zoom}px) scale(${1 / vm.viewport.zoom})`
}}>{Math.round(vm.frameDrawRect.right - vm.frameDrawRect.left)}
{" × "}
{Math.round(vm.frameDrawRect.bottom - vm.frameDrawRect.top)}</span></div></div>) : (null)}
<div className={"forge3d-node-actions"} style={{
  transform: `translate(${vm.viewport.x}px, ${vm.viewport.y}px) scale(${vm.viewport.zoom})`
}}>{(vm.uploadWells).map((well) => (<button key={well.key} type={"button"} onPointerDown={($event: any) => { $event.stopPropagation() }} onClick={($event: any) => { $event.stopPropagation(); vm.onNodeAction({
  nodeId: well.nodeId,
  id: 'upload'
}); }} onDragOver={($event: any) => { $event.stopPropagation(); $event.preventDefault() }} onDrop={($event: any) => { $event.stopPropagation(); $event.preventDefault(); vm.onUploadWellDrop($event, well); }} className={"forge3d-upload-well"} style={{
  left: `${well.x}px`,
  top: `${well.y}px`,
  width: `${well.w}px`,
  height: `${well.h}px`
}}><strong >{"Drop or choose asset"}</strong>
<small >{"JPG, PNG, WEBP or 3D model · max 100 MB"}</small></button>))}
{(vm.textFields).map((field) => (<textarea key={field.key} value={field.value} placeholder={field.placeholder} aria-label={field.label} spellCheck={"false"} onPointerDown={($event: any) => { $event.stopPropagation() }} onWheel={($event: any) => { $event.stopPropagation() }} onKeyDown={($event: any) => { $event.stopPropagation() }} onKeyUp={($event: any) => { $event.stopPropagation() }} onChange={($event: any) => { vm.host?.commitText(field.nodeId, field.paramKey, $event.target.value); }} className={"forge3d-node-textarea"} style={{
  left: `${field.x}px`,
  top: `${field.y}px`,
  width: `${field.w}px`,
  height: `${field.h}px`
}} />))}
{(vm.nodeActions).map((action) => (<button key={action.key} type={"button"} title={action.label} aria-label={action.label} onPointerDown={($event: any) => { $event.stopPropagation() }} onClick={($event: any) => { $event.stopPropagation(); vm.onNodeAction(action); }} className={cx("forge3d-node-action", [action.kind === 'icon' ? 'forge3d-node-action-icon' : 'forge3d-node-action-text', action.icon === 'remove' ? 'forge3d-node-action-remove' : '', {
  'forge3d-node-action-hidden': action.kind === 'icon' && action.nodeId !== vm.hoveredNodeId
}])} style={{
  left: `${action.x}px`,
  top: `${action.y}px`,
  width: `${action.w}px`,
  height: `${action.h}px`
}}>{(action.icon === 'replace') ? (<svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path fill={"none"} stroke={"currentColor"} strokeWidth={"1.5"} strokeLinecap={"round"} strokeLinejoin={"round"} d={"M13.2 8A5.2 5.2 0 1 1 11 3.6M13.2 2.2v3.2H10"} /></svg>) : ((action.icon === 'remove') ? (<svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path fill={"none"} stroke={"currentColor"} strokeWidth={"1.5"} strokeLinecap={"round"} strokeLinejoin={"round"} d={"M3.2 4.2h9.6M6.2 4.2V3h3.6v1.2M4.4 4.2l.6 8.2h5.9l.6-8.2"} /></svg>) : ((action.icon === 'download') ? (<svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path fill={"none"} stroke={"currentColor"} strokeWidth={"1.5"} strokeLinecap={"round"} strokeLinejoin={"round"} d={"M8 2.5v7M5.2 7.2 8 10l2.8-2.8M3.2 13.2h9.6"} /></svg>) : ((action.icon === 'model') ? (<svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path fill={"none"} stroke={"currentColor"} strokeWidth={"1.5"} strokeLinejoin={"round"} d={"m8 2.2 5 2.8v5.6l-5 2.8-5-2.8V5z"} />
<path fill={"none"} stroke={"currentColor"} strokeWidth={"1.5"} strokeLinejoin={"round"} d={"M3 5.1 8 8l5-2.9M8 8v5.4"} /></svg>) : (<span >{action.label}</span>))))}</button>))}
{(vm.renameField) ? (<form onSubmit={($event: any) => { $event.preventDefault(); vm.commitRename($event) }} className={"forge3d-node-rename"} style={{
  left: `${vm.renameField.x}px`,
  top: `${vm.renameField.y}px`,
  width: `${vm.renameField.w}px`,
  height: `${vm.renameField.h}px`
}}><input ref={vm.$ref("renameInput")} value={vm.renameDraft ?? ''} aria-label={"Node name"} spellCheck={"false"} onChange={($event: any) => { vm.renameDraft = $event.target.value }} onPointerDown={($event: any) => { $event.stopPropagation() }} onKeyDown={($event: any) => { (($event: any) => { $event.stopPropagation() })($event); (($event: any) => { if (!['Enter'].includes($event.key)) return; $event.preventDefault(); vm.commitRename($event) })($event); (($event: any) => { if (!['Escape'].includes($event.key)) return; $event.preventDefault(); vm.cancelRename($event) })($event) }} onBlur={($event: any) => { vm.commitRename($event) }} style={{
  left: `${vm.renameField.textX}px`,
  width: `calc(100% - ${vm.renameField.textX}px)`,
  color: vm.renameField.color
}} /></form>) : (null)}</div>
{(vm.frameButton) ? (<button type={"button"} onPointerDown={($event: any) => { $event.stopPropagation() }} onClick={($event: any) => { vm.sectionRunning(vm.frameButton.id) ? vm.emit('stop-run') : vm.emit('run-section', vm.frameButton.id); }} className={"forge3d-frame-run"} style={{
  left: `${vm.frameButton.left}px`,
  top: `${vm.frameButton.top}px`
}}>{vm.sectionRunning(vm.frameButton.id) ? 'Stop' : 'Run'}</button>) : (null)}
<canvas ref={vm.$ref("mapEl")} width={"220"} height={"140"} aria-label={"Canvas map"} onPointerDown={($event: any) => { vm.onMapPointerDown($event) }} onPointerMove={($event: any) => { vm.onMapPointerMove($event) }} onPointerUp={($event: any) => { vm.onMapPointerUp($event) }} onPointerCancel={($event: any) => { vm.onMapPointerUp($event) }} onContextMenu={($event: any) => { $event.preventDefault() }} className={"forge3d-minimap"} />
<input ref={vm.$ref("fileInput")} type={"file"} accept={"image/jpeg,image/png,image/webp,.glb,.gltf,.fbx,.usdz,.obj,.stl,.3mf"} onChange={($event: any) => { vm.onFilePicked($event) }} className={"forge3d-litegraph-file"} /></div>
  )
}
