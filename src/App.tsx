import { Fragment, lazy, Suspense } from 'react'
import { derived, nextTick, onMounted, onUnmounted, portalTarget, state, watch, useSetup, cx } from './store'
import ChatPanel from "./components/ChatPanel";
import AssetLibraryView from "./components/AssetLibraryView";
import CanvasContextMenu from "./components/CanvasContextMenu";
import CanvasToolbar from "./components/CanvasToolbar";
import ImagePreviewOverlay from "./components/ImagePreviewOverlay";
import ApiKeysDialog from "./components/ApiKeysDialog";
import NameDialog from "./components/NameDialog";
import DebugPanel from "./components/DebugPanel";
import ExecutionOutputPanel from "./components/ExecutionOutputPanel";
import RunLogPanel from "./components/RunLogPanel";
import TopBar from "./components/TopBar";
import LiteGraphCanvas from "./components/LiteGraphCanvas";
import { createAgentChat } from './state/agentChat';
import { createAssetLibrary } from './state/assetLibrary';
import { createCanvasFrames } from './state/canvasFrames';
import { createFrameDraw } from './state/frameDraw';
import { createCanvasHistory } from './state/canvasHistory';
import { createCanvasPresence } from './state/canvasPresence';
import { createCanvasSelection } from './state/canvasSelection';
import { createKeyboardShortcuts } from './state/keyboardShortcuts';
import { createTheme } from './state/theme';
import { createCanvasDocument } from './state/canvasDocument';
import { createCanvasRun } from './state/canvasRun';
import { createDebugSettings } from './state/debugSettings';
import { createApiKeys } from './state/apiKeys';
import { request } from './api';
import { readClipboardFragment } from './canvas-fragment';
import { edgeDefaults, nodePresentation } from '@forge3d/canvas-core';
import { applyNodeParameter, defaultCanvasProvider } from '@forge3d/canvas-core';
import { activeInputPorts, canConnectNodeTypes, canConnectPorts, compatibleNodeTypes, compatibleUpstreamNodeTypes, hasModelEditor, isExecutableNodeType, missingParametersByNode, nodeCatalog, nodeCategories, nodeDefaults, nodeOutputPorts, outputPortsOf } from '@forge3d/canvas-core';
import { resultArtifacts } from './run-results';
import { resultSpecs } from '@forge3d/canvas-core';
import { reconcileResultSlots } from '@forge3d/canvas-core';

// Loaded on first open: three.js and the viewer stay out of the main chunk.
const ModelEditor = lazy(() => import('./components/ModelEditor'))

const SPEC = { props: [], emits: [] }

export default function App(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    
    // The document and canvas state every composable below works on.
    const canvases = state([]);
    const activeCanvas = state(null);
    const activeSession = state(null);
    const nodes = state([]);
    const edges = state([]);
    // Wire ties: pins a few wires must pass through. See wire-tie.ts.
    const wireTies = state([]);
    const run = state(null);
    const nodeRuns = state({});
    const agentBusy = state(false);
    const canvasBusy = state(false);
    const error = state('');
    const canvasError = state('');
    const saving = state(false);
    const savedState = state('Saved');
    // A canvas switch invalidates both independently-running domains. A node run and
    // an Agent turn never invalidate or block one another.
    const agentToken = state(0);
    const canvasRunToken = state(0);
    let restoreSuccessfulResults = async () => {};
    
    // Canvas chrome: menus, overlays and the two view/mode switches.
    const contextMenu = state(null);
    const nodeMenuOpen = state(false);
    const nodeMenuContext = state(null);
    const viewportDismissVersion = state(0);
    const canvasMenu = state(null);
    const canvasSwitcherOpen = state(false);
    const nameDialog = state(null);
    function askName(title, value) {
      if (nameDialog.value) return Promise.resolve('');
      canvasSwitcherOpen.value = false;
      return new Promise(resolve => {
        nameDialog.value = {
          title,
          value,
          resolve
        };
      });
    }
    function settleName(name) {
      const pending = nameDialog.value;
      if (!pending) return;
      nameDialog.value = null;
      pending.resolve(name || '');
    }
    const workspaceMode = state('canvas');
    // Embedded inside DeepSeek Harness the harness conversation drives the canvas
    // through its own tools, so the in-app copilot panel is redundant and takes the
    // space the canvas wants. The panel is compiled out and the canvas spans the
    // full width; nothing else about the app changes.
    const embedded = __FORGE3D_EMBED__;
    const canvasMode = state('select');
    const canvasView = state('canvas');
    const modelEditorNodeId = state(null);
    const imagePreview = state(null);
    const runSummaryOpen = state(false);
    const taskQueueOpen = state(false);
    const editLockedNoticeOpen = state(false);
    const editLockedNoticeName = state('');
    let pendingConnection = null;
    const connectionSourceId = state(null);
    let editLockedNoticeTimer;
    const graphCanvas = state(null);
    const viewport = state({
      x: 0,
      y: 0,
      zoom: 1
    });
    function fitView(options) {
      graphCanvas.value?.fitView(options);
    }
    function screenToFlowCoordinate(point) {
      return graphCanvas.value?.screenToFlowCoordinate(point) || {
        x: point.x,
        y: point.y
      };
    }
    function updateNodeInternals() {}
    function findNode(id) {
      return graphCanvas.value?.findNode(id) || null;
    }
    const {
      theme,
      resolvedTheme,
      setTheme
    } = createTheme();
    const {
      deepseekKey,
      meshyKey,
      usingOwnKeys,
      apiKeysOpen,
      saveApiKeys,
      dismissApiKeys
    } = createApiKeys();
    const {
      clientId,
      canEdit,
      editorName,
      acquireEditLease,
      markEditActivity,
      configureIdleRelease,
      applyPresenceEvent,
      canvasOpened,
      releasePresence
    } = createCanvasPresence({
      activeCanvas,
      error
    });
    function ensureEditAccess(event?: Event) {
      if (!canEdit.value) {
        if (editorName.value) showEditLockedNotice();
        acquireEditLease();
      }
      return true;
    }
    function showEditLockedNotice() {
      if (!editorName.value) return;
      editLockedNoticeName.value = editorName.value;
      editLockedNoticeOpen.value = true;
      clearTimeout(editLockedNoticeTimer);
      editLockedNoticeTimer = setTimeout(() => {
        editLockedNoticeOpen.value = false;
        editLockedNoticeName.value = '';
      }, 3000);
    }
    watch(editorName, name => {
      if (name) showEditLockedNotice();
    });
    const {
      selectedNodes,
      frameableSelectedNodes,
      canFrameSelection,
      canDissolveSelection,
      selectedCount,
      hasSelection,
      deleteSelected,
      dissolveSelectedFrames,
      selectAll,
      onEdgeClick,
      copySelected,
      cutSelected,
      pasteFragment,
      duplicateSelected,
      createCanvasFromSelection
    } = createCanvasSelection({
      nodes,
      edges,
      activeCanvas,
      error,
      saveCanvas: () => saveCanvas(),
      fromCanvas: () => fromCanvas(),
      toCanvas: canvas => toCanvas(canvas),
      loadCanvass: preferredId => loadCanvass(preferredId),
      focusNodes,
      askName
    });
    const {
      fitFramesAfterRender,
      suppressFrameFit,
      makeSelectionFrame,
      onCanvasPointerDown,
      onSelectionStart,
      onSelectionEnd,
      onElementsChange,
      onFrameResizeEnd,
      onNodeDragStart,
      onNodeDragStop,
      autoLayout
    } = createCanvasFrames({
      nodes,
      edges,
      screenToFlowCoordinate,
      updateNodeInternals,
      saveCanvas: () => saveCanvas(),
      frameableSelectedNodes,
      nextNodeId,
      focusNode
    });
    const {
      drawRect: frameDrawRect,
      drawing: frameDrawing,
      onFrameDrawPointerDown,
      cancelFrameDraw
    } = createFrameDraw({
      nodes,
      edges,
      canvasMode,
      activeCanvas,
      screenToFlowCoordinate,
      nextNodeId,
      saveCanvas: () => saveCanvas(),
      // A click that never became a drag falls back to the default centred section.
      createDefaultFrame: point => addNode('frame', null, point)
    });
    const {
      syncHistoryCanvas,
      recordHistory,
      undo,
      redo
    } = createCanvasHistory({
      nodes,
      edges,
      wireTies,
      activeCanvas,
      hydrating: derived(() => hydrating.value),
      updateNodeInternals,
      saveCanvas: () => saveCanvas()
    });
    const {
      hydrating,
      toCanvas,
      fromCanvas,
      syncCanvasSummary,
      loadCanvass,
      openCanvas,
      openingCanvas,
      saveCanvas,
      stopPendingSave,
      duplicateCanvas,
      deleteCanvas,
      creatingCanvas,
      createCanvas,
      renameCanvas,
      setCanvasProvider,
      exportCanvas,
      importCanvasFile,
      refreshCanvasFromServer
    } = createCanvasDocument({
      canvases,
      activeCanvas,
      activeSession,
      nodes,
      edges,
      wireTies,
      // The camera, so a pan or a zoom is part of what gets saved.
      viewport,
      run,
      nodeRuns,
      busy: agentBusy,
      error,
      saving,
      savedState,
      agentToken,
      canvasRunToken,
      fitView,
      recordHistory,
      syncHistoryCanvas,
      fitFramesAfterRender,
      suppressFrameFit,
      loadSessions: id => loadSessions(id),
      restoreTurns: () => restoreTurns(),
      subscribeCanvasEvents: id => subscribeCanvasEvents(id),
      closeCanvasEvents: () => closeCanvasEvents(),
      pasteFragment,
      resetWorkspace,
      closeCanvasSwitcher,
      clientId,
      canvasOpened,
      releasePresence,
      acquireEditLease,
      markEditActivity,
      onCanvasHydrated: canvasId => restoreSuccessfulResults(canvasId),
      askName
    });
    const {
      composer,
      composerHasContent,
      messages,
      selectedOptions,
      continuingTurnId,
      addComposerFiles,
      loadSessions,
      restoreTurns,
      subscribeCanvasEvents,
      closeCanvasEvents,
      toggleSelectedOption,
      continueTurn,
      sendMessage,
      retryMessage
    } = createAgentChat({
      activeCanvas,
      activeSession,
      busy: agentBusy,
      error,
      runToken: agentToken,
      toCanvas: canvas => toCanvas(canvas),
      syncCanvasSummary: canvas => syncCanvasSummary(canvas),
      // An Agent turn cannot wait out the debounce: the server reads the canvas.
      saveCanvas: () => saveCanvas({
        immediate: true
      }),
      onCanvasEvent: applyPresenceEvent,
      onCanvasDocumentEvent: () => refreshCanvasFromServer(),
      // A canvas edit pushed while the event channel was down is missed too, so pick
      // the document back up alongside the turns.
      onReconnect: () => refreshCanvasFromServer(),
      clientId,
      acquireEditLease,
      markEditActivity
    });
    configureIdleRelease({
      // Releasing the edit lease hands the canvas to someone else, so land it first.
      flush: () => saveCanvas({
        immediate: true
      }),
      isBusy: () => saving.value || agentBusy.value || isRunning.value
    });
    const {
      capabilitiesError,
      debugMode,
      debugPanelOpen,
      tripoAvailable,
      meshyAvailable,
      tripoNodeTypes,
      meshyNodeTypes
    } = createDebugSettings();
    const {
      isRunning,
      runDetails,
      runSummary,
      runCanvas,
      cancelRun,
      executions,
      executionsLoading,
      loadExecutions,
      restoreSuccessfulResults: restoreResults,
      activeExecutions
    } = createCanvasRun({
      activeCanvas,
      nodes,
      edges,
      run,
      nodeRuns,
      canvasBusy,
      error: canvasError,
      runToken: canvasRunToken,
      // A run cannot wait out the debounce: creating it reads the saved canvas.
      saveCanvas: () => saveCanvas({
        immediate: true
      }),
      materializeResults: (sourceId, runId, output, status) => fillResults(sourceId, runId, output, status)
    });
    restoreSuccessfulResults = restoreResults;
    watch([() => run.value?.id, () => run.value?.status], ([runId]) => {
      if (runId) taskQueueOpen.value = true;
    });
    watch(() => activeCanvas.value?.id, canvasId => {
      loadExecutions(canvasId);
    }, {
      immediate: true
    });
    
    // Cover every insertion and removal path, including the canvas's own delete
    // handling. Adding or removing a node is structural rather than a tweak, so it does
    // not wait out the throttle interval; the callers that also touch edges queue a
    // follow-up save for those. A save mid-removal is still correct: an edge whose
    // node is gone has no resolvable ports, so the domain conversion drops it.
    watch(() => nodes.value.length, () => {
      saveCanvas({
        immediate: true
      });
    }, {
      flush: 'sync'
    });
    
    // A section runs from its first executable child that nothing inside the section
    // feeds, falling back to the first executable child when they are all fed.
    function sectionEntryNodeId(frameId) {
      const children = nodes.value.filter(node => node.parentNode === frameId);
      const childIds = new Set(children.map(node => node.id));
      const executable = children.filter(node => isExecutableNodeType(node.data?.canvasType));
      return executable.find(node => !edges.value.some(edge => childIds.has(edge.source) && edge.target === node.id))?.id || executable[0]?.id;
    }
    function runSection(frameId) {
      const entryNodeId = sectionEntryNodeId(frameId);
      if (entryNodeId) runCanvas(entryNodeId, 'downstream');
    }
    function sectionIsRunning(frameId) {
      return nodes.value.some(node => node.parentNode === frameId && ['queued', 'running', 'cancelling'].includes(nodeRuns.value[node.id]?.status));
    }
    const {
      rails: assetRails,
      library: assetLibrary,
      loading: assetsLoading,
      loadAssets
    } = createAssetLibrary({
      activeCanvas,
      error
    });
    const toolbarMenuOpen = derived(() => nodeMenuOpen.value && !nodeMenuContext.value);
    // Assets outlive their nodes, so the model editor is only offered for the ones
    // whose node is still on the canvas.
    const canvasNodeIds = derived(() => nodes.value.map(node => node.id));
    const modelEditorNode = derived(() => nodes.value.find(node => node.id === modelEditorNodeId.value) || null);
    
    // The library reads the run history, so it is refetched when the panel opens and
    // whenever a run finishes adding to that history.
    watch([canvasView, () => activeCanvas.value?.id], ([view]) => {
      if (view === 'assets') loadAssets();
    });
    watch(isRunning, (running, wasRunning) => {
      if (wasRunning && !running && canvasView.value === 'assets') loadAssets();
    });
    
    // The single input handle is untyped, so the inbound media is read from what
    // each upstream node produces rather than from a named target port.
    function inboundSourceNodes(nodeId) {
      return edges.value.filter(edge => edge.target === nodeId).map(edge => nodes.value.find(node => node.id === edge.source)).filter(Boolean);
    }
    function inboundExportTarget(nodeId) {
      const sources = inboundSourceNodes(nodeId);
      if (sources.some(node => outputPortsOf(node.data?.canvasType, node.data?.uploadAssets)[0]?.type === 'model')) return '3D Model';
      if (sources.some(node => outputPortsOf(node.data?.canvasType, node.data?.uploadAssets)[0]?.type === 'image')) return 'Image';
      return null;
    }
    function inboundImage(nodeId) {
      for (const source of inboundSourceNodes(nodeId)) {
        if (outputPortsOf(source.data?.canvasType, source.data?.uploadAssets)[0]?.type !== 'image') continue;
        const output = source.data?.generatedAssets;
        const image = output?.selectedPreview || output?.preview || output?.previews?.[0];
        if (image) return image;
      }
      return null;
    }
    
    // A node missing a parameter it runs with cannot run, so the canvas explains
    // what is missing rather than letting the run reach the server and come back a
    // 400. Read from the domain canvas because a parameter an input port carries is
    // satisfied by a connection, while the canvas keeps its connections on a single
    // untyped handle — converted once per canvas change for every node rather than
    // once per node.
    const missingParameters = derived(() => {
      void nodes.value;
      void edges.value;
      const canvas = fromCanvas();
      return canvas ? missingParametersByNode(canvas) : {};
    });
    
    // The canvas as it would be saved, for the debug panel to put on the clipboard.
    // Read from the canvas rather than refetched, so it shows unsaved edits too.
    function canvasJson() {
      const canvas = fromCanvas();
      return canvas ? JSON.stringify(canvas, null, 2) : null;
    }
    function onGraphConnectStart(nodeId) {
      pendingConnection = {
        nodeId,
        sourceHandle: 'output'
      };
      connectionSourceId.value = nodeId;
    }
    function isValidConnection(connection) {
      if (!connection?.source || !connection?.target || connection.source === connection.target) return false;
      const source = nodes.value.find(node => node.id === connection.source);
      const target = nodes.value.find(node => node.id === connection.target);
      return Boolean(source && target && canConnectNodeTypes(source.data.canvasType, target.data.canvasType));
    }
    function addConnection(connection) {
      const source = nodes.value.find(node => node.id === connection.source);
      const target = nodes.value.find(node => node.id === connection.target);
      if (!source || !target || !isValidConnection(connection)) return false;
      const exists = edges.value.some(edge => edge.source === source.id && edge.target === target.id);
      if (exists) return false;
      // A collapsed visual handle carries its logical port pairs as edge data. Most
      // connections leave this to the save-time inference; a reroute that knows the
      // pairs (a view result re-homed onto a multi-view port) passes them explicitly.
      const logicalConnections = connection.logicalConnections?.length ? {
        logicalConnections: connection.logicalConnections
      } : null;
      edges.value = [...edges.value, {
        id: `edge-${source.id}-${target.id}-${Date.now().toString(36)}`,
        source: source.id,
        target: target.id,
        sourceHandle: 'output',
        targetHandle: 'input',
        ...(logicalConnections ? {
          data: logicalConnections
        } : {}),
        ...edgeDefaults
      }];
      saveCanvas();
      return true;
    }
    function onGraphConnectEnd(payload) {
      if (payload?.sourceId) openNodeMenuAt(payload.clientX, payload.clientY, payload.sourceId);
      pendingConnection = null;
      connectionSourceId.value = null;
    }
    function updateNodeParameter({
      id,
      key,
      value
    }) {
      const node = nodes.value.find(candidate => candidate.id === id);
      if (!node) return;
      const provider = activeCanvas.value?.provider || node.data.provider || defaultCanvasProvider;
      updateNodeConfig(id, applyNodeParameter(node.data.canvasType, node.data.config, key, value, provider));
    }
    function updateNodeConfig(id, config) {
      const node = nodes.value.find(candidate => candidate.id === id);
      if (!node) return;
      const inputPorts = activeInputPorts(node.data.canvasType, config);
      const previous = new Set((node.data.inputPorts || []).map(port => port.id));
      const portsChanged = inputPorts.length !== previous.size || inputPorts.some(port => !previous.has(port.id));
      node.data = {
        ...node.data,
        config,
        inputPorts
      };
      syncResultSlots();
      // The other mode's wires are not inputs anymore. Drop them so a later save
      // cannot retarget a loose image onto Front, or a labeled view onto Image.
      if (portsChanged) {
        const allowed = new Set(inputPorts.map(port => port.id));
        edges.value = edges.value.flatMap(edge => {
          if (edge.target !== id) return [edge];
          const pairs = edge.data?.logicalConnections;
          if (!pairs?.length) return [];
          const next = pairs.filter(pair => allowed.has(pair.targetPort));
          return next.length ? [{
            ...edge,
            data: {
              ...edge.data,
              logicalConnections: next
            }
          }] : [];
        });
      }
      saveCanvas();
    }
    
    // Edits the upload tree, the one alongside config. A copied node keeps it: the
    // asset is input the user gave. An uploaded asset is the one edit the throttle
    // interval must not hold: the bytes are already on the server, and a canvas that
    // loses the URL pointing at them cannot get it back.
    function updateNodeUploads(id, uploadAssets) {
      const node = nodes.value.find(candidate => candidate.id === id);
      if (!node) return;
      const outputPorts = outputPortsOf(node.data.canvasType, uploadAssets);
      node.data = {
        ...node.data,
        uploadAssets,
        outputPorts
      };
      const portId = outputPorts[0]?.id;
      edges.value = edges.value.flatMap(edge => {
        if (edge.source !== node.id) return [edge];
        if (!portId) return [];
        const pairs = edge.data?.logicalConnections;
        if (!pairs?.length) return [edge];
        const next = pairs.filter(pair => pair.sourcePort === portId);
        return next.length ? [{
          ...edge,
          data: {
            ...edge.data,
            logicalConnections: next
          }
        }] : [];
      });
      saveCanvas({
        immediate: true
      });
    }
    
    // Edits the result tree, the third sibling. Copying a node drops it.
    function clearNodeUpload(id) {
      const node = nodes.value.find(candidate => candidate.id === id);
      if (!node) return;
      const {
        assetType,
        assetUrl,
        modelUrl,
        reference,
        thumbnailUrl,
        ...rest
      } = node.data.uploadAssets || {};
      updateNodeUploads(id, rest);
      if (node.data.generatedAssets?.preview) {
        const {
          preview,
          ...remaining
        } = node.data.generatedAssets;
        updateNodeOutput(id, remaining);
      }
    }
    function updateNodeOutput(id, generatedAssets) {
      const node = nodes.value.find(candidate => candidate.id === id);
      if (!node) return;
      node.data = {
        ...node.data,
        generatedAssets
      };
      saveCanvas();
    }
    function updateNodeName(id, name) {
      const node = nodes.value.find(candidate => candidate.id === id);
      const normalized = name.trim();
      if (!node || !normalized || normalized === node.data.label) return;
      node.data = {
        ...node.data,
        label: normalized
      };
      saveCanvas();
    }
    function openModelEditor(id) {
      if (!id) return;
      const node = nodes.value.find(candidate => candidate.id === id);
      const uploadedModel = node?.data.canvasType === 'reference-image' && node.data.uploadAssets?.assetType === 'model' && typeof node.data.uploadAssets?.modelUrl === 'string';
      // A model result node carries its file in generatedAssets: it was never run, so
      // there is no node run to check.
      const resultModel = node?.data.canvasType === 'generated-model' && typeof node.data.generatedAssets?.modelUrl === 'string';
      if (!node || !hasModelEditor(node.data.canvasType) || !uploadedModel && !resultModel && nodeRuns.value[id]?.status !== 'succeeded') return;
      modelEditorNodeId.value = node.id;
      workspaceMode.value = 'model-editor';
      nextTick(() => window.scrollTo({
        top: 0
      }));
    }
    function closeModelEditor() {
      workspaceMode.value = 'canvas';
      modelEditorNodeId.value = null;
      // The canvas stayed mounted under the editor, so its view is left as it was.
      nextTick(() => {
        window.scrollTo({
          top: 0
        });
      });
    }
    function openImagePreview(preview) {
      imagePreview.value = preview;
    }
    function closeImagePreview() {
      imagePreview.value = null;
    }
    
    // Opening another canvas leaves the model editor and any open overlay behind.
    function resetWorkspace() {
      closeCanvasSwitcher();
      cancelFrameDraw();
      canvasMode.value = 'select';
      imagePreview.value = null;
      workspaceMode.value = 'canvas';
      modelEditorNodeId.value = null;
    }
    function nextNodeId(type, taken = new Set()) {
      const ids = new Set([...nodes.value.map(node => node.id), ...taken]);
      if (!ids.has(type)) return type;
      let index = 2;
      while (ids.has(`${type}-${index}`)) index += 1;
      return `${type}-${index}`;
    }
    function nodePosition(sourceId) {
      const source = sourceId ? nodes.value.find(node => node.id === sourceId) : null;
      if (source) return {
        x: source.position.x + 340,
        y: source.position.y
      };
      const selected = selectedNodes.value[0];
      if (selected) return {
        x: selected.position.x + 310,
        y: selected.position.y + 24
      };
      if (!nodes.value.length) return {
        x: 120,
        y: 120
      };
      return {
        x: Math.max(...nodes.value.map(node => node.position.x)) + 310,
        y: Math.min(...nodes.value.map(node => node.position.y))
      };
    }
    function upstreamNodePosition(targetId) {
      const target = targetId ? nodes.value.find(node => node.id === targetId) : null;
      if (target) return {
        x: target.position.x - 340,
        y: target.position.y
      };
      return nodePosition(null);
    }
    function canvasCenterPosition() {
      const bounds = document.querySelector('.forge3d-flow-canvas')?.getBoundingClientRect();
      if (!bounds) return {
        x: 120,
        y: 120
      };
      return screenToFlowCoordinate({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
      });
    }
    
    // fitView silently ignores nodes it has not measured yet, and a freshly added
    // node is measured by a ResizeObserver whose timing we cannot predict, so wait
    // for real dimensions rather than a fixed number of frames.
    async function waitForNodeDimensions(ids, attempts = 30) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (ids.every(id => {
          const node = findNode(id);
          return node && node.dimensions.width > 0 && node.dimensions.height > 0;
        })) return true;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return false;
    }
    async function focusNodes(ids, padding = 0.25) {
      if (!ids.length) return;
      await nextTick();
      await waitForNodeDimensions(ids);
      fitView({
        nodes: ids,
        padding,
        maxZoom: 1,
        duration: 350
      });
    }
    function focusNode(id, padding = 0.25) {
      focusNodes([id], padding);
    }
    function fitCanvasView() {
      const selectedIds = selectedNodes.value.map(node => node.id);
      fitView({
        ...(selectedIds.length ? {
          nodes: selectedIds
        } : {}),
        padding: 0.18,
        duration: 400
      });
    }
    async function arrangeCanvas() {
      nodes.value = nodes.value.map(node => {
        const live = findNode(node.id);
        const width = live?.dimensions?.width;
        const height = live?.dimensions?.height;
        if (!width || !height) return node;
        return {
          ...node,
          width,
          height,
          dimensions: {
            width,
            height
          }
        };
      });
      // Layout moves nodes only. The camera stays put, so a tie the user placed
      // stays where it is on screen too.
      await autoLayout();
    }
    function buildCanvasNode(type, {
      id,
      position,
      selected = false,
      config,
      uploadAssets,
      generatedAssets,
      parentNode,
      initialAsset
    } = {}) {
      const [kind, detail, tone] = nodePresentation[type];
      const provider = activeCanvas.value?.provider || defaultCanvasProvider;
      const nodeConfig = {
        ...nodeDefaults(type, provider),
        ...config
      };
      const data = {
        kind,
        label: nodeCatalog.find(item => item.type === type)?.label || type,
        detail,
        tone,
        status: 'ready',
        canvasType: type,
        provider,
        config: nodeConfig,
        uploadAssets: {
          ...uploadAssets
        },
        generatedAssets: {
          ...generatedAssets
        },
        inputPorts: activeInputPorts(type, nodeConfig),
        outputPorts: outputPortsOf(type, uploadAssets)
      };
      // File objects are only a hand-off from the canvas drop to the mounted node.
      // Keep the property out of enumerable snapshots so history/serialization can
      // never retain a non-JSON upload trigger.
      if (initialAsset) Object.defineProperty(data, 'initialAsset', {
        value: initialAsset,
        configurable: true
      });
      return {
        id: id || nextNodeId(type),
        type: 'canvas',
        position,
        parentNode,
        selected,
        data
      };
    }
    function addNode(type, sourceId, position, {
      initialAsset
    } = {}) {
      const presentation = nodePresentation[type];
      if (!presentation || !activeCanvas.value) return;
      if (type === 'frame') {
        const width = 900;
        const height = 600;
        const center = position || canvasCenterPosition();
        const frame = {
          id: nextNodeId(type),
          type: 'frame',
          position: {
            x: center.x - width / 2,
            y: center.y - height / 2
          },
          width,
          height,
          selected: true,
          style: {
            pointerEvents: 'none'
          },
          data: {
            label: 'New canvas section',
            description: ''
          }
        };
        nodes.value = [frame, ...nodes.value.map(item => ({
          ...item,
          selected: false
        }))];
        closeContextMenu();
        saveCanvas();
        focusNode(frame.id);
        return;
      }
      const node = buildCanvasNode(type, {
        position: position || nodePosition(sourceId),
        selected: true,
        initialAsset
      });
      nodes.value = [...nodes.value.map(item => ({
        ...item,
        selected: false
      })), node];
      syncResultSlots();
      closeContextMenu();
      saveCanvas();
      nextTick(() => {
        if (sourceId) {
          addConnection({
            source: sourceId,
            sourceHandle: 'output',
            target: node.id,
            targetHandle: 'input'
          });
        }
      });
      // fitView ignores nodes it has not measured yet, so this has to wait for the
      // node to render or the viewport would never move.
      focusNode(node.id);
    }
    function addUpstreamNode(type, targetId, position) {
      const target = targetId ? nodes.value.find(node => node.id === targetId) : null;
      if (!target || !activeCanvas.value || !nodePresentation[type] || !canConnectNodeTypes(type, target.data.canvasType)) return;
      const node = buildCanvasNode(type, {
        position: position || upstreamNodePosition(targetId),
        selected: true
      });
      nodes.value = [...nodes.value.map(item => ({
        ...item,
        selected: false
      })), node];
      syncResultSlots();
      closeContextMenu();
      nextTick(() => {
        addConnection({
          source: node.id,
          sourceHandle: 'output',
          target: target.id,
          targetHandle: 'input'
        });
        saveCanvas();
      });
      focusNode(node.id);
    }
    
    // A stage owns a fixed set of result nodes from the moment it is created (see
    // canvas-result-slots.ts), so a run only fills them in. Nothing is created,
    // removed or moved here: what the workflow looks like before a run is what it
    // looks like after.
    function slotIdsOf(stageId) {
      return nodes.value.filter(node => node.data?.generatedAssets?.resultOf?.sourceId === stageId);
    }
    function fillResults(stageId, runId, output, status) {
      const stage = nodes.value.find(node => node.id === stageId);
      if (!stage || !runId || status !== 'succeeded') return;
      const specs = resultSpecs(stage.data.canvasType, stage.data.config);
      if (!specs.length) return;
      const artifacts = resultArtifacts(stage.data.canvasType, output, {
        runId,
        sourceId: stageId
      }, {
        allowEmpty: status === 'succeeded'
      });
      const filled = new Map(specs.map((spec, index) => [spec.slot, artifacts[index] || null]));
      nodes.value = nodes.value.map(node => {
        if (node.data?.generatedAssets?.resultOf?.sourceId !== stageId) return node;
        const spec = specs.find(candidate => candidate.slot === node.data.generatedAssets.slot);
        if (!spec) return node;
        const artifact = filled.get(spec.slot);
        return {
          ...node,
          data: {
            ...node.data,
            generatedAssets: {
              ...(artifact?.generatedAssets || {}),
              resultOf: {
                runId,
                sourceId: stageId
              },
              slot: spec.slot,
              ...(spec.view ? {
                view: spec.view
              } : {})
            }
          }
        };
      });
      saveCanvas();
    }
    
    // The slots follow a stage's Images count: changing it adds or removes result
    // nodes on the spot, so the canvas always shows what the stage can produce.
    function syncResultSlots() {
      const repair = reconcileResultSlots({
        nodes: nodes.value,
        edges: edges.value,
        provider: activeCanvas.value?.provider
      });
      if (!repair.added.length && !repair.removed.length) return;
      nodes.value = repair.canvas.nodes;
      edges.value = repair.canvas.edges;
    }
    function catalogForMenu() {
      if (!nodeMenuContext.value?.sourceId) return nodeCatalog.filter(item => !item.hidden);
      const source = nodes.value.find(node => node.id === nodeMenuContext.value.sourceId);
      return source ? compatibleNodeTypes(source.data.canvasType, source.data.canvasType === 'reference-image' ? source.data.uploadAssets : undefined) : [];
    }
    function openNodeMenuAt(clientX, clientY, sourceId = null) {
      nodeMenuContext.value = {
        sourceId,
        position: screenToFlowCoordinate({
          x: clientX,
          y: clientY
        }),
        left: clientX,
        top: clientY
      };
      nodeMenuOpen.value = true;
      constrainContextMenu();
    }
    function closeContextMenu() {
      nodeMenuOpen.value = false;
      nodeMenuContext.value = null;
    }
    function dismissCanvasPopups() {
      closeContextMenu();
      viewportDismissVersion.value += 1;
    }
    function onPaneClick() {
      dismissCanvasPopups();
      const hadSelection = nodes.value.some(node => node.selected) || edges.value.some(edge => edge.selected);
      if (!hadSelection) return;
      nodes.value = nodes.value.map(node => node.selected ? {
        ...node,
        selected: false
      } : node);
      edges.value = edges.value.map(edge => edge.selected ? {
        ...edge,
        selected: false
      } : edge);
    }
    function openCanvasMenu(event, canvas) {
      event.preventDefault();
      const width = 164;
      const height = 84;
      const gap = 8;
      canvasMenu.value = {
        canvasId: canvas.id,
        left: Math.min(event.clientX, window.innerWidth - width - gap),
        top: Math.min(event.clientY, window.innerHeight - height - gap)
      };
    }
    function closeCanvasMenu() {
      canvasMenu.value = null;
    }
    function closeCanvasSwitcher() {
      canvasSwitcherOpen.value = false;
    }
    function runCanvasMenuAction(action) {
      const canvasId = canvasMenu.value?.canvasId;
      closeCanvasMenu();
      action(canvasId);
    }
    async function constrainContextMenu() {
      await nextTick();
      const menu = contextMenu.value?.$el;
      if (!menu || !nodeMenuContext.value) return;
      const panel = document.querySelector('.forge3d-flow-canvas')?.getBoundingClientRect();
      if (!panel) return;
      const gap = 8;
      nodeMenuContext.value.maxWidth = Math.max(0, panel.width - gap * 2);
      nodeMenuContext.value.maxHeight = Math.max(0, panel.height - gap * 2);
      await nextTick();
      nodeMenuContext.value.left = Math.max(panel.left + gap, Math.min(nodeMenuContext.value.left + gap, panel.right - menu.offsetWidth - gap));
      nodeMenuContext.value.top = Math.max(panel.top + gap, Math.min(nodeMenuContext.value.top + gap, panel.bottom - menu.offsetHeight - gap));
    }
    function openSelectionMenuAt(clientX, clientY) {
      nodeMenuContext.value = {
        kind: 'selection',
        left: clientX,
        top: clientY
      };
      nodeMenuOpen.value = true;
      constrainContextMenu();
    }
    function onPaneContextMenu(event) {
      event.preventDefault();
      if (selectedNodes.value.length > 1) {
        openSelectionMenuAt(event.clientX, event.clientY);
        return;
      }
      openNodeMenuAt(event.clientX, event.clientY);
    }
    function onFrameContextMenu({
      event,
      id
    }) {
      event.preventDefault();
      edges.value = edges.value.map(edge => edge.selected ? {
        ...edge,
        selected: false
      } : edge);
      nodeMenuContext.value = {
        kind: 'section',
        frameId: id,
        left: event.clientX,
        top: event.clientY
      };
      nodeMenuOpen.value = true;
      constrainContextMenu();
    }
    function onNodeContextMenu({
      event,
      node
    }) {
      event.preventDefault();
      if (!node.selected) {
        nodes.value = nodes.value.map(item => ({
          ...item,
          selected: item.id === node.id
        }));
        edges.value = edges.value.map(edge => ({
          ...edge,
          selected: false
        }));
      }
      openSelectionMenuAt(event.clientX, event.clientY);
    }
    function onSelectionContextMenu({
      event
    }) {
      event.preventDefault();
      openSelectionMenuAt(event.clientX, event.clientY);
    }
    async function pasteClipboard() {
      if (workspaceMode.value !== 'canvas') return;
      try {
        const fragment = await readClipboardFragment();
        if (!fragment) return;
        if (!ensureEditAccess()) return;
        pasteFragment(fragment, {
          selectInserted: true
        });
      } catch {
        error.value = 'Could not paste the selection';
      }
    }
    function runContextMenuAction(action) {
      const context = nodeMenuContext.value;
      closeContextMenu();
      if (context?.kind === 'section' && context.frameId) {
        nodes.value = nodes.value.map(node => ({
          ...node,
          selected: node.id === context.frameId
        }));
        edges.value = edges.value.map(edge => ({
          ...edge,
          selected: false
        }));
      }
      action();
    }
    function renameSection() {
      const frame = nodes.value.find(node => node.selected && node.type === 'frame');
      if (!frame) return;
      const name = window.prompt('Rename section', frame.data?.label || 'Section')?.trim();
      if (name) updateNodeName(frame.id, name);
    }
    function selectNodeType(type) {
      const context = nodeMenuContext.value;
      // A section is drawn, not placed: picking it from the menu arms the draw tool
      // instead of dropping a frame where the menu happened to be open.
      if (type === 'frame') {
        closeContextMenu();
        canvasMode.value = 'frame';
        return;
      }
      addNode(type, context?.sourceId, context?.position);
    }
    function toggleTieMode() {
      cancelFrameDraw();
      canvasMode.value = canvasMode.value === 'tie' ? 'select' : 'tie';
    }
    function toggleFrameMode() {
      cancelFrameDraw();
      canvasMode.value = canvasMode.value === 'frame' ? 'select' : 'frame';
    }
    function startNodeDrag(event, type) {
      event.dataTransfer.setData('application/x-canvas-node', type);
      event.dataTransfer.effectAllowed = 'copy';
    }
    function isSupportedCanvasImage(file) {
      return new Set(['image/jpeg', 'image/png', 'image/webp']).has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
    }
    function onCanvasDragOver(event) {
      if (event.dataTransfer.types.includes('application/x-canvas-node') || event.dataTransfer.types.includes('Files')) event.preventDefault();
    }
    function onCanvasDrop(event) {
      const type = event.dataTransfer.getData('application/x-canvas-node');
      const position = screenToFlowCoordinate({
        x: event.clientX,
        y: event.clientY
      });
      if (type) {
        event.preventDefault();
        addNode(type, null, position);
        return;
      }
      // Claim file drops even when the file is unsupported, so the browser never
      // navigates away from the canvas to open it.
      event.preventDefault();
      const [file] = [...(event.dataTransfer.files || [])];
      if (!file || !isSupportedCanvasImage(file)) return;
      addNode('reference-image', null, position, {
        initialAsset: file
      });
    }
    createKeyboardShortcuts({
      imagePreview,
      workspaceMode,
      canvasSwitcherOpen,
      nodeMenuOpen,
      canvasMenu,
      hasSelection,
      canvasMode,
      frameDrawing,
      cancelFrameDraw,
      closeImagePreview,
      closeModelEditor,
      closeCanvasSwitcher,
      closeContextMenu,
      closeCanvasMenu,
      nameDialogOpen: nameDialog,
      closeNameDialog: () => settleName(null),
      openNodeMenuAt,
      undo,
      redo,
      selectAll,
      copySelected,
      cutSelected,
      pasteFragment,
      duplicateSelected,
      deleteSelected,
      ensureEditAccess
    });
    async function handleProjectNavigation() {
      if (__FORGE3D_EMBED__) return;
      const projectId = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/)?.[1];
      if (!projectId || projectId === activeCanvas.value?.id) return;
      try {
        await openCanvas(projectId, {
          replaceHistory: true
        });
      } catch (caught) {
        error.value = caught.message;
      }
    }
    // Inside the harness page, gestures over the harness are the harness's.
    function insideApp(target: EventTarget | null) {
      return !__FORGE3D_EMBED__ || portalTarget().contains(target as Node);
    }
    function preventNativePinchZoom(event: Event) {
      if (insideApp(event.target)) event.preventDefault();
    }
    function preventPageTrackpadPinchZoom(event: WheelEvent) {
      // Pinch (ctrl+wheel) never zooms the page. The canvas zooms itself from its own listener.
      if (event.ctrlKey && insideApp(event.target)) event.preventDefault();
    }
    async function releaseOnBlur() {
      try {
        await saveCanvas({
          immediate: true,
          keepalive: true
        });
      } finally {
        await releasePresence(undefined, {
          keepalive: true
        });
      }
    }
    function flushWhenHidden() {
      if (document.visibilityState === 'hidden') releaseOnBlur();else refreshOnFocus();
    }
    function refreshOnFocus() {
      refreshCanvasFromServer().catch(caught => {
        error.value = caught.message;
      });
    }
    onMounted(async () => {
      window.addEventListener('pointerdown', closeCanvasMenu);
      window.addEventListener('popstate', handleProjectNavigation);
      window.addEventListener('blur', releaseOnBlur);
      window.addEventListener('focus', refreshOnFocus);
      window.addEventListener('pagehide', releaseOnBlur);
      document.addEventListener('visibilitychange', flushWhenHidden);
      document.addEventListener('gesturestart', preventNativePinchZoom, {
        passive: false
      });
      document.addEventListener('gesturechange', preventNativePinchZoom, {
        passive: false
      });
      document.addEventListener('wheel', preventPageTrackpadPinchZoom, {
        capture: true,
        passive: false
      });
      try {
        await loadCanvass();
      } catch (caught) {
        error.value = caught.message;
      }
    });
    onUnmounted(() => {
      stopPendingSave();
      clearTimeout(editLockedNoticeTimer);
      window.removeEventListener('pointerdown', closeCanvasMenu);
      window.removeEventListener('popstate', handleProjectNavigation);
      window.removeEventListener('blur', releaseOnBlur);
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener('pagehide', releaseOnBlur);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      document.removeEventListener('gesturestart', preventNativePinchZoom);
      document.removeEventListener('gesturechange', preventNativePinchZoom);
      document.removeEventListener('wheel', preventPageTrackpadPinchZoom, true);
    });
    return {
      request,
      readClipboardFragment,
      edgeDefaults,
      nodePresentation,
      applyNodeParameter,
      defaultCanvasProvider,
      activeInputPorts,
      canConnectNodeTypes,
      canConnectPorts,
      compatibleNodeTypes,
      compatibleUpstreamNodeTypes,
      hasModelEditor,
      isExecutableNodeType,
      missingParametersByNode,
      nodeCatalog,
      nodeCategories,
      nodeDefaults,
      nodeOutputPorts,
      outputPortsOf,
      resultArtifacts,
      resultSpecs,
      reconcileResultSlots,
      canvases,
      activeCanvas,
      activeSession,
      nodes,
      edges,
      wireTies,
      run,
      nodeRuns,
      agentBusy,
      canvasBusy,
      error,
      canvasError,
      saving,
      savedState,
      agentToken,
      canvasRunToken,
      get restoreSuccessfulResults() { return restoreSuccessfulResults }, set restoreSuccessfulResults(v) { restoreSuccessfulResults = v },
      contextMenu,
      nodeMenuOpen,
      nodeMenuContext,
      viewportDismissVersion,
      canvasMenu,
      canvasSwitcherOpen,
      nameDialog,
      askName,
      settleName,
      workspaceMode,
      embedded,
      canvasMode,
      canvasView,
      modelEditorNodeId,
      imagePreview,
      runSummaryOpen,
      taskQueueOpen,
      editLockedNoticeOpen,
      editLockedNoticeName,
      get pendingConnection() { return pendingConnection }, set pendingConnection(v) { pendingConnection = v },
      connectionSourceId,
      get editLockedNoticeTimer() { return editLockedNoticeTimer }, set editLockedNoticeTimer(v) { editLockedNoticeTimer = v },
      graphCanvas,
      viewport,
      fitView,
      screenToFlowCoordinate,
      updateNodeInternals,
      findNode,
      theme,
      resolvedTheme,
      setTheme,
      deepseekKey,
      meshyKey,
      usingOwnKeys,
      apiKeysOpen,
      saveApiKeys,
      dismissApiKeys,
      clientId,
      canEdit,
      editorName,
      acquireEditLease,
      markEditActivity,
      configureIdleRelease,
      applyPresenceEvent,
      canvasOpened,
      releasePresence,
      ensureEditAccess,
      showEditLockedNotice,
      selectedNodes,
      frameableSelectedNodes,
      canFrameSelection,
      canDissolveSelection,
      selectedCount,
      hasSelection,
      deleteSelected,
      dissolveSelectedFrames,
      selectAll,
      onEdgeClick,
      copySelected,
      cutSelected,
      pasteFragment,
      duplicateSelected,
      createCanvasFromSelection,
      fitFramesAfterRender,
      suppressFrameFit,
      makeSelectionFrame,
      onCanvasPointerDown,
      onSelectionStart,
      onSelectionEnd,
      onElementsChange,
      onFrameResizeEnd,
      onNodeDragStart,
      onNodeDragStop,
      autoLayout,
      frameDrawRect,
      frameDrawing,
      onFrameDrawPointerDown,
      cancelFrameDraw,
      syncHistoryCanvas,
      recordHistory,
      undo,
      redo,
      hydrating,
      toCanvas,
      fromCanvas,
      syncCanvasSummary,
      loadCanvass,
      openCanvas,
      openingCanvas,
      saveCanvas,
      stopPendingSave,
      duplicateCanvas,
      deleteCanvas,
      creatingCanvas,
      createCanvas,
      renameCanvas,
      setCanvasProvider,
      exportCanvas,
      importCanvasFile,
      refreshCanvasFromServer,
      composer,
      composerHasContent,
      messages,
      selectedOptions,
      continuingTurnId,
      addComposerFiles,
      loadSessions,
      restoreTurns,
      subscribeCanvasEvents,
      closeCanvasEvents,
      toggleSelectedOption,
      continueTurn,
      sendMessage,
      retryMessage,
      capabilitiesError,
      debugMode,
      debugPanelOpen,
      tripoAvailable,
      meshyAvailable,
      tripoNodeTypes,
      meshyNodeTypes,
      isRunning,
      runDetails,
      runSummary,
      runCanvas,
      cancelRun,
      executions,
      executionsLoading,
      loadExecutions,
      restoreResults,
      activeExecutions,
      sectionEntryNodeId,
      runSection,
      sectionIsRunning,
      assetRails,
      assetLibrary,
      assetsLoading,
      loadAssets,
      toolbarMenuOpen,
      canvasNodeIds,
      modelEditorNode,
      inboundSourceNodes,
      inboundExportTarget,
      inboundImage,
      missingParameters,
      canvasJson,
      onGraphConnectStart,
      isValidConnection,
      addConnection,
      onGraphConnectEnd,
      updateNodeParameter,
      updateNodeConfig,
      updateNodeUploads,
      clearNodeUpload,
      updateNodeOutput,
      updateNodeName,
      openModelEditor,
      closeModelEditor,
      openImagePreview,
      closeImagePreview,
      resetWorkspace,
      nextNodeId,
      nodePosition,
      upstreamNodePosition,
      canvasCenterPosition,
      waitForNodeDimensions,
      focusNodes,
      focusNode,
      fitCanvasView,
      arrangeCanvas,
      buildCanvasNode,
      addNode,
      addUpstreamNode,
      slotIdsOf,
      fillResults,
      syncResultSlots,
      catalogForMenu,
      openNodeMenuAt,
      closeContextMenu,
      dismissCanvasPopups,
      onPaneClick,
      openCanvasMenu,
      closeCanvasMenu,
      closeCanvasSwitcher,
      runCanvasMenuAction,
      constrainContextMenu,
      openSelectionMenuAt,
      onPaneContextMenu,
      onFrameContextMenu,
      onNodeContextMenu,
      onSelectionContextMenu,
      pasteClipboard,
      runContextMenuAction,
      renameSection,
      selectNodeType,
      toggleTieMode,
      toggleFrameMode,
      startNodeDrag,
      isSupportedCanvasImage,
      onCanvasDragOver,
      onCanvasDrop,
      handleProjectNavigation,
      preventNativePinchZoom,
      preventPageTrackpadPinchZoom,
      releaseOnBlur,
      flushWhenHidden,
      refreshOnFocus
    }
  })
  return (
    <main {...vm.$attrs} className={cx("forge:grid forge:h-full forge:w-full forge:grid-rows-[68px_minmax(0,1fr)] forge:bg-bg-primary forge:transition-colors forge:duration-200 forge:max-[760px]:h-auto forge:max-[760px]:min-h-full forge:max-[760px]:grid-rows-[58px_auto]", vm.$attrs.className)} style={vm.$attrs.style}>{(vm.editLockedNoticeOpen) ? (<div role={"alert"} className={"forge:fixed forge:left-1/2 forge:top-4 forge:z-[1000] forge:flex forge:min-w-[300px] forge:-translate-x-1/2 forge:items-center forge:gap-[18px] forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-panel forge:py-3 forge:pl-4 forge:pr-3 forge:text-[13px] forge:text-text-primary forge:shadow-popover"}><span ><strong >{vm.editLockedNoticeName}</strong>
{" 正在编辑此画布"}</span></div>) : (null)}
<TopBar switcherOpen={vm.canvasSwitcherOpen} activeCanvas={vm.activeCanvas} canvases={vm.canvases} workspaceMode={vm.workspaceMode} canvasView={vm.canvasView} savedState={vm.savedState} theme={vm.theme} busy={vm.agentBusy || vm.creatingCanvas || vm.openingCanvas} usingOwnKeys={vm.usingOwnKeys} onUpdateSwitcherOpen={($event: any) => { vm.canvasSwitcherOpen = $event }} onRename={($event: any) => { vm.renameCanvas($event) }} onOpenCanvas={($event: any) => { vm.openCanvas($event) }} onCreateCanvas={($event: any) => { vm.createCanvas($event) }} onCanvasContextMenu={($event: any) => { vm.openCanvasMenu($event.event, $event.canvas); }} onImportFile={($event: any) => { vm.importCanvasFile($event) }} onSetTheme={($event: any) => { vm.setTheme($event) }} onUpdateCanvasView={($event: any) => { vm.canvasView = $event; }} onOpenApiKeys={($event: any) => { vm.apiKeysOpen = true; }} />
{(vm.canvasMenu) ? (<div onPointerDown={($event: any) => { $event.stopPropagation() }} className={"forge3d-menu forge:fixed forge:z-40 forge:grid forge:w-[164px] forge:gap-[3px] forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-[5px] forge:shadow-popover"} style={{
  left: `${vm.canvasMenu.left}px`,
  top: `${vm.canvasMenu.top}px`
}}><button type={"button"} onClick={($event: any) => { vm.runCanvasMenuAction(vm.exportCanvas); }} className={"forge:min-h-[34px] forge:rounded-md forge:border-0 forge:bg-transparent forge:px-[9px] forge:py-[7px] forge:text-left forge:text-[12px] forge:font-medium forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))]"}>{"Export JSON"}</button>
<button type={"button"} onClick={($event: any) => { vm.runCanvasMenuAction(vm.duplicateCanvas); }} className={"forge:min-h-[34px] forge:rounded-md forge:border-0 forge:bg-transparent forge:px-[9px] forge:py-[7px] forge:text-left forge:text-[12px] forge:font-medium forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))]"}>{"Duplicate"}</button>
<button type={"button"} onClick={($event: any) => { vm.runCanvasMenuAction(vm.deleteCanvas); }} className={"forge:min-h-[34px] forge:rounded-md forge:border-0 forge:bg-transparent forge:px-[9px] forge:py-[7px] forge:text-left forge:text-[12px] forge:font-medium forge:text-status-failed forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--status-failed)_10%,transparent)]"}>{"Delete"}</button></div>) : (null)}
<section className={cx(vm.embedded ? 'forge:relative forge:grid forge:min-h-0 forge:grid-cols-[minmax(0,1fr)] forge:grid-rows-[minmax(0,1fr)] forge:overflow-hidden' : 'forge:relative forge:grid forge:min-h-0 forge:grid-cols-[350px_minmax(0,1fr)] forge:grid-rows-[minmax(0,1fr)] forge:overflow-hidden forge:max-[1200px]:grid-cols-[310px_minmax(0,1fr)] forge:max-[760px]:grid-cols-1 forge:max-[760px]:grid-rows-[480px_620px]')}>{(!vm.embedded) ? (<ChatPanel messages={vm.messages} editor={vm.composer} busy={vm.agentBusy} error={vm.error} composerHasContent={vm.composerHasContent} continuingTurnId={vm.continuingTurnId} selectedOptions={vm.selectedOptions} onSend={($event: any) => { vm.sendMessage($event) }} onEngaged={($event: any) => { vm.saveCanvas({
  immediate: true
}); }} onAttachFiles={($event: any) => { vm.addComposerFiles($event) }} onToggleOption={($event: any) => { vm.toggleSelectedOption($event.message, $event.optionId); }} onContinueTurn={($event: any) => { vm.continueTurn($event) }} onRetry={($event: any) => { vm.retryMessage($event) }} />) : (null)}
<section onPointerDown={($event: any) => { vm.closeContextMenu($event) }} className={"forge3d-canvas-panel forge:relative forge:grid forge:min-h-0 forge:min-w-0 forge:grid-rows-[minmax(0,1fr)_40px] forge:overflow-hidden forge:bg-bg-secondary forge:transition-colors forge:duration-200"}>{(vm.nodeMenuOpen && vm.nodeMenuContext) ? (<CanvasContextMenu expose={vm.$ref("contextMenu")} context={vm.nodeMenuContext} catalog={vm.catalogForMenu()} categories={vm.nodeCategories} canFrameSelection={vm.canFrameSelection} canDissolveSelection={vm.canDissolveSelection} hasClipboard={true} onFrameSelection={($event: any) => { vm.runContextMenuAction(vm.makeSelectionFrame); }} onDissolveSelection={($event: any) => { vm.runContextMenuAction(vm.dissolveSelectedFrames); }} onRename={($event: any) => { vm.runContextMenuAction(vm.renameSection); }} onCreateCanvas={($event: any) => { vm.runContextMenuAction(vm.createCanvasFromSelection); }} onCopy={($event: any) => { vm.runContextMenuAction(vm.copySelected); }} onCut={($event: any) => { vm.runContextMenuAction(vm.cutSelected); }} onPaste={($event: any) => { vm.runContextMenuAction(vm.pasteClipboard); }} onDuplicate={($event: any) => { vm.runContextMenuAction(vm.duplicateSelected); }} onDelete={($event: any) => { vm.runContextMenuAction(vm.deleteSelected); }} onSelectNodeType={($event: any) => { vm.selectNodeType($event) }} onDragNodeType={($event: any) => { vm.startNodeDrag($event.event, $event.type); }} />) : (null)}
<LiteGraphCanvas expose={vm.$ref("graphCanvas")} nodes={vm.nodes} edges={vm.edges} wireTies={vm.wireTies} nodeRuns={vm.nodeRuns} missingParameters={vm.missingParameters} theme={vm.resolvedTheme} canvasMode={vm.canvasMode} frameDrawRect={vm.frameDrawRect} sectionRunning={vm.sectionIsRunning} onUpdateNodes={($event: any) => { vm.nodes = $event; }} onUpdateEdges={($event: any) => { vm.edges = $event; vm.saveCanvas(); }} onUpdateWireTies={($event: any) => { vm.wireTies = $event; vm.saveCanvas(); }} onUpdateParameter={($event: any) => { vm.updateNodeParameter($event) }} onUpdateUploads={($event: any) => { vm.updateNodeUploads($event.id, $event.uploadAssets); }} onUpdateOutput={($event: any) => { vm.updateNodeOutput($event.id, $event.generatedAssets); }} onClearUpload={($event: any) => { vm.clearNodeUpload($event) }} onUpdateName={($event: any) => { vm.updateNodeName($event.id, $event.name); }} onPointerDownCapture={($event: any) => { vm.onCanvasPointerDown($event); vm.onFrameDrawPointerDown($event); }} onDragOver={($event: any) => { vm.onCanvasDragOver($event) }} onDrop={($event: any) => { vm.onCanvasDrop($event) }} onPaneClick={($event: any) => { vm.onPaneClick($event) }} onPaneContextMenu={($event: any) => { vm.onPaneContextMenu($event) }} onFrameContextMenu={($event: any) => { vm.onFrameContextMenu($event) }} onNodeContextMenu={($event: any) => { vm.onNodeContextMenu($event) }} onConnectStart={($event: any) => { vm.onGraphConnectStart($event) }} onConnectEnd={($event: any) => { vm.onGraphConnectEnd($event) }} onDragStart={($event: any) => { vm.onNodeDragStart($event) }} onDragStop={($event: any) => { vm.onNodeDragStop($event) }} onSelectionStart={($event: any) => { vm.onSelectionStart($event) }} onSelectionEnd={($event: any) => { vm.onSelectionEnd($event) }} onEdgeClick={($event: any) => { vm.onEdgeClick($event) }} onPreviewImage={($event: any) => { vm.openImagePreview($event) }} onRunNode={($event: any) => { vm.runCanvas($event, 'node'); }} onRunDownstream={($event: any) => { vm.runCanvas($event, 'downstream'); }} onStopRun={($event: any) => { vm.cancelRun($event) }} onOpenModelEditor={($event: any) => { vm.openModelEditor($event) }} onRunSection={($event: any) => { vm.runSection($event) }} onViewport={($event: any) => { vm.viewport = $event; }} style={{ ...((vm.canvasView === 'canvas') ? null : { display: 'none' }) }} />
{(vm.canvasView === 'assets') ? (<AssetLibraryView rails={vm.assetRails} total={vm.assetLibrary.total} loading={vm.assetsLoading} canvasNodeIds={vm.canvasNodeIds} onPreview={($event: any) => { vm.openImagePreview($event) }} onOpenModelEditor={($event: any) => { vm.openModelEditor($event) }} />) : (null)}
{(vm.runDetails && vm.runSummaryOpen) ? (<RunLogPanel details={vm.runDetails} onClose={($event: any) => { vm.runSummaryOpen = false; }} />) : (null)}
<CanvasToolbar canvasView={vm.canvasView} canvasMode={vm.canvasMode} nodeCount={vm.nodes.length} edgeCount={vm.edges.length} selectedCount={vm.selectedCount} assetLibrary={vm.assetLibrary} hasCanvas={Boolean(vm.activeCanvas)} isRunning={vm.isRunning} menuOpen={vm.toolbarMenuOpen} catalog={vm.catalogForMenu()} categories={vm.nodeCategories} onUpdateCanvasView={($event: any) => { vm.canvasView = $event; }} onUpdateCanvasMode={($event: any) => { vm.canvasMode = $event; }} onToggleMenu={($event: any) => { vm.nodeMenuContext = null; vm.nodeMenuOpen = !vm.nodeMenuOpen; }} onSelectNodeType={($event: any) => { vm.selectNodeType($event) }} onDragNodeType={($event: any) => { vm.startNodeDrag($event.event, $event.type); }} onToggleFrameMode={($event: any) => { vm.toggleFrameMode($event) }} onToggleTieMode={($event: any) => { vm.toggleTieMode($event) }} onFitView={($event: any) => { vm.fitCanvasView($event) }} onAutoLayout={($event: any) => { vm.arrangeCanvas($event) }}><span className={"forge:flex forge:h-full forge:items-center forge:gap-[7px]"}><i className={"forge:size-[7px] forge:rounded-full forge:bg-acid forge:shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_60%,transparent)]"} />
{vm.runSummary}</span>
{(vm.runDetails) ? (<button type={"button"} aria-expanded={vm.runSummaryOpen} onClick={($event: any) => { vm.runSummaryOpen = !vm.runSummaryOpen; }} className={"forge:flex forge:h-[19px] forge:items-center forge:gap-[5px] forge:rounded forge:border forge:border-line-strong forge:bg-bg-input forge:px-[7px] forge:font-mono forge:text-[10px] forge:font-semibold forge:text-acid forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))]"}>{vm.runSummaryOpen ? 'Hide logs' : 'Logs'}
{" "}
<b className={"forge:text-[11px] forge:font-medium"}>{vm.runSummaryOpen ? '↓' : '↑'}</b></button>) : (null)}</CanvasToolbar></section>
<button type={"button"} aria-expanded={vm.taskQueueOpen} aria-controls={"task-queue-panel"} onClick={($event: any) => { vm.taskQueueOpen = !vm.taskQueueOpen; }} className={"forge:absolute forge:right-0 forge:top-[14px] forge:z-[21] forge:flex forge:h-[42px] forge:w-9 forge:items-center forge:justify-center forge:gap-[3px] forge:rounded-l-[21px] forge:rounded-r-none forge:border forge:border-r-0 forge:border-acid-line forge:bg-bg-card forge:font-mono forge:text-[11px] forge:font-semibold forge:text-acid forge:shadow-[-5px_4px_14px_rgba(20,26,22,.1)] forge:transition-[right] forge:duration-200 forge:has-[+_.forge3d-is-open]:right-[300px] forge:max-[1200px]:has-[+_.forge3d-is-open]:right-[270px] forge:max-[760px]:has-[+_.forge3d-is-open]:right-[min(300px,90vw)]"}><span aria-hidden={"true"}>{vm.taskQueueOpen ? '→' : '←'}</span>
<b className={"forge:text-[11px] forge:text-text-secondary"}>{vm.executions.length + (vm.run?.id && !vm.executions.some(execution => execution.id === vm.run.id) ? 1 : 0)}</b></button>
<ExecutionOutputPanel id={"task-queue-panel"} executions={vm.executions} activeExecution={vm.run} activeExecutions={vm.activeExecutions} loading={vm.executionsLoading} className={cx({
  'forge3d-is-open': vm.taskQueueOpen
})} />
{(vm.workspaceMode !== 'canvas' && vm.modelEditorNode) ? (<Suspense fallback={null}><ModelEditor className={"forge:absolute forge:inset-0 forge:z-[50] forge:overflow-auto"} node={vm.modelEditorNode} onBack={() => { vm.closeModelEditor() }} onUpdateConfig={($event: any) => { vm.updateNodeConfig(vm.modelEditorNode.id, $event); }} /></Suspense>) : (null)}</section>
{(vm.creatingCanvas || vm.openingCanvas) ? (<div role={"status"} aria-live={"polite"} aria-busy={"true"} aria-label={"Loading"} className={"forge3d-create-mask"}><span className={"forge3d-create-spin"} />
<span className={"forge3d-create-label"}>{"Loading"}</span></div>) : (null)}
<ImagePreviewOverlay preview={vm.imagePreview} onClose={($event: any) => { vm.closeImagePreview($event) }} />
<ApiKeysDialog open={vm.apiKeysOpen} deepseekKey={vm.deepseekKey} meshyKey={vm.meshyKey} onSave={($event: any) => { vm.saveApiKeys($event) }} onDismiss={($event: any) => { vm.dismissApiKeys($event) }} />
<NameDialog open={Boolean(vm.nameDialog)} title={vm.nameDialog?.title || ''} initial={vm.nameDialog?.value || ''} onConfirm={($event: any) => { vm.settleName($event) }} onDismiss={($event: any) => { vm.settleName(null); }} />
{(vm.debugMode) ? (<DebugPanel open={vm.debugPanelOpen} activeProvider={vm.activeCanvas?.provider || vm.defaultCanvasProvider} tripoAvailable={vm.tripoAvailable} meshyAvailable={vm.meshyAvailable} providerLocked={Boolean(vm.activeCanvas?.nodes?.length)} tripoNodeTypes={vm.tripoNodeTypes} meshyNodeTypes={vm.meshyNodeTypes} error={vm.capabilitiesError} readCanvasJson={vm.canvasJson} onUpdateOpen={($event: any) => { vm.debugPanelOpen = $event }} onSetProvider={($event: any) => { vm.setCanvasProvider($event) }} />) : (null)}</main>
  )
}
