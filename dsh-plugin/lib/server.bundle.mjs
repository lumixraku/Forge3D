// server/sqlite-store.ts
import { mkdir as mkdir2, readFile as readFile2, readdir } from "node:fs/promises";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { createHash as createHash2 } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// server/store.ts
import path from "node:path";
import { fileURLToPath } from "node:url";

// packages/canvas-core/src/canvas-schema.ts
var defaultCanvasProvider = "meshy";
var options = (entries) => entries.map(([value, label]) => ({ value, label }));
var imageModels = options([
  ["gemini_3.1_flash_image_preview", "Nano Banana 2"],
  ["gemini_2.5_flash_image_preview", "Nano Banana"],
  ["gemini_3_pro_image_preview", "Nano Banana Pro"],
  ["gpt_image_2", "GPT Image 2"],
  ["gpt_image_1.5", "GPT Image 1.5"],
  ["midjourney", "Midjourney"]
]);
var modelVersions = options([["v3.1-20260211", "v3.1 \xB7 Best Quality"], ["v3.0-20250812", "v3.0 \xB7 Fast & Balanced"], ["v2.5-20250123", "v2.5 \xB7 Legacy"]]);
var textureQualities = options([["standard", "2K"], ["detailed", "4K"], ["extreme", "8K"]]);
var topology = options([["triangle", "Triangle"], ["quad", "Quad"]]);
var retopologyTopology = options([["quad", "Quad"], ["triangle", "Triangle"]]);
var detailLevels = options([["low", "Simple \xB7 3-6 parts"], ["medium", "Balanced \xB7 6-15 parts"], ["high", "Detailed \xB7 15+ parts"]]);
var imageAmounts = options([[1, "1"], [2, "2"], [3, "3"], [4, "4"]]);
var scales = options([["1:1", "1:1"], ["3:4", "3:4"], ["4:3", "4:3"], ["9:16", "9:16"], ["16:9", "16:9"]]);
var legacyPreviewPaths = /* @__PURE__ */ new Set([
  "/shark-reference.png",
  "/shark-concept-front.png",
  "/shark-concept-left.png",
  "/shark-concept-right.png",
  "/shark-concept-back.png",
  "/shark-model.png",
  "/shark-retopology.png",
  "/shark-textured.png",
  "/shark-review.png"
]);
var multiViewImages = { front: { type: "image" }, back: { type: "image" }, left: { type: "image" }, right: { type: "image" } };
var viewKeys = Object.keys(multiViewImages);
var promptText = { type: "text", fallbackConfig: "prompt" };
var multiImage = { type: "image", multiple: true };
var modelDefaults = { modelVersion: "v3.1-20260211", geometryQuality: true, aiComplete: false, texture: true, textureQuality: "extreme", pbr: true, topology: "triangle", faceCount: 2e6, generateParts: false, texture8k: true, privacy: "sharing-only" };
var modelParameters = [
  { key: "modelVersion", label: "AI Model", control: "select", options: modelVersions.map((option) => option.value === "v3.1-20260211" ? { ...option, inputs: [{ key: "geometryQuality", label: "Ultra Mesh Quality", control: "toggle" }] } : option) },
  { key: "aiComplete", label: "AI Complete", control: "toggle", advanced: true },
  { key: "texture", label: "Texture", control: "toggle", options: [{ value: true, label: "On", inputs: [
    { key: "textureQuality", label: "Texture Quality", control: "segmented", options: textureQualities },
    { key: "pbr", label: "PBR", control: "toggle", advanced: true },
    { key: "texture8k", label: "8K Texture", control: "toggle", advanced: true }
  ] }] },
  { key: "topology", label: "Topology", control: "segmented", advanced: true, options: topology },
  { key: "faceCount", label: "Polycount", control: "slider", advanced: true, range: { min: 500, max: 1e6, step: 500, rules: [{ when: [{ field: "geometryQuality", equals: true }], max: 2e6 }, { when: [{ field: "topology", equals: "quad" }], max: 5e4 }, { when: [{ field: "generateParts", equals: true }], min: 1e4 }] } },
  { key: "generateParts", label: "Generate in Parts", control: "toggle", advanced: true },
  { key: "privacy", label: "Privacy", control: "select", advanced: true, options: options([["sharing-only", "Sharing Only"], ["private", "Private"]]) }
];
var modelEffects = [{ when: { field: "generateParts", equals: true }, set: { topology: "triangle", texture: false, pbr: false } }];
var meshyPolycount = (max) => ({ key: "faceCount", label: "Target Polycount", control: "slider", range: { min: 100, max, step: 100 } });
var meshyGeometryResolution = { key: "geometryResolution", label: "Geometry Resolution", control: "segmented", options: options([["standard", "Standard"], ["2k", "2K"], ["4k", "4K"]]) };
var meshyModelDefaults = { modelType: "standard", aiModel: "latest", geometryResolution: "standard", texture: true, textureQuality: "standard", pbr: true, topology: "triangle", faceCount: 0, shouldRemesh: false, poseMode: "" };
var meshyModelParameters = [
  { key: "modelType", label: "Mesh Type", control: "select", options: [
    { value: "standard", label: "Standard", inputs: [
      { key: "aiModel", label: "Meshy Model", control: "select", options: [
        { value: "latest", label: "Latest", inputs: [meshyGeometryResolution] },
        { value: "meshy-7.1", label: "Meshy 7.1", inputs: [meshyGeometryResolution] },
        { value: "meshy-7", label: "Meshy 7" },
        { value: "meshy-6", label: "Meshy 6" },
        { value: "meshy-6-lite", label: "Meshy 6 Lite" }
      ] },
      { key: "shouldRemesh", label: "Remesh", control: "toggle", options: [{ value: true, label: "On", inputs: [
        { key: "topology", label: "Topology", control: "segmented", options: topology },
        meshyPolycount(3e5)
      ] }] }
    ] },
    { value: "smart-topology", label: "Smart Topology", inputs: [
      { key: "aiModel", label: "Meshy Model", control: "select", options: [
        { value: "meshy-t2.5", label: "Meshy T2.5", inputs: [meshyPolycount(3e4)] },
        { value: "meshy-t2", label: "Meshy T2", inputs: [meshyPolycount(15e3)] }
      ] }
    ] }
  ] },
  { key: "texture", label: "Texture", control: "toggle", options: [{ value: true, label: "On", inputs: [
    { key: "textureQuality", label: "Texture Resolution", control: "segmented", options: options([["standard", "2K"], ["detailed", "4K"], ["extreme", "8K"]]) },
    { key: "pbr", label: "PBR", control: "toggle", advanced: true }
  ] }] },
  { key: "poseMode", label: "Pose", control: "select", options: options([["", "None"], ["a-pose", "A-Pose"], ["t-pose", "T-Pose"]]) }
];
var meshyRigParameters = [
  { key: "heightMeters", label: "Height (m)", control: "slider", range: { min: 0.5, max: 2.5, step: 0.1 } }
];
var imageAiModels = options([
  ["nano-banana", "Nano Banana"],
  ["nano-banana-2", "Nano Banana 2"],
  ["nano-banana-2-lite", "Nano Banana 2 Lite"],
  ["nano-banana-pro", "Nano Banana Pro"],
  ["gpt-image-2", "GPT Image 2"],
  ["gpt-image-2-5-flare", "GPT Image 2.5 Flare"],
  ["gpt-image-2-5-sunburst", "GPT Image 2.5 Sunburst"]
]);
var imageAspects = options([["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["4:3", "4:3"], ["3:4", "3:4"], ["3:2", "3:2"], ["2:3", "2:3"]]);
var imageStepParameters = [
  { key: "aiModel", label: "Image Model", control: "select", options: imageAiModels },
  { key: "generateMultiView", label: "Multi-view", control: "toggle", options: [{ value: false, label: "Off", inputs: [{ key: "aspectRatio", label: "Aspect Ratio", control: "select", options: imageAspects }] }] },
  { key: "poseMode", label: "Pose", control: "select", options: options([["", "None"], ["a-pose", "A-Pose"], ["t-pose", "T-Pose"]]) },
  { key: "removeBackground", label: "Remove Background", control: "toggle" }
];
var imageStepDefaults = { aiModel: "nano-banana", generateMultiView: false, aspectRatio: "1:1", poseMode: "", removeBackground: false, prompt: "" };
var printerBrands = options([["bambu", "Bambu"], ["anycubic", "Anycubic"], ["creality", "Creality"], ["elegoo", "Elegoo"], ["flashforge", "Flashforge"], ["prusa", "Prusa"], ["qidi", "Qidi"], ["snapmaker", "Snapmaker"], ["ankermake", "Ankermake"]]);
var meshyApiNodes = [
  { type: "text-to-image", category: "2D", label: "Text to Image", description: "Meshy text-to-image. Multi-view returns three angles.", presentation: { kind: "IMAGE", detail: "Text to image", tone: "amber" }, inputs: { text: promptText }, outputs: { image: { type: "image" }, front: { type: "image" }, side: { type: "image" }, back: { type: "image" } }, requires: ["text"], executable: true, defaults: { ...imageStepDefaults }, parameters: imageStepParameters },
  { type: "image-to-image", category: "2D", label: "Image to Image", description: "Edit a reference image with a Meshy prompt", presentation: { kind: "IMAGE", detail: "Image edit", tone: "amber" }, inputs: { image: multiImage, text: promptText }, outputs: { image: { type: "image" }, front: { type: "image" }, side: { type: "image" }, back: { type: "image" } }, requires: ["image", "text"], executable: true, defaults: { ...imageStepDefaults, prompt: "Keep the subject and change the style" }, parameters: [...imageStepParameters, { key: "prompt", label: "Prompt", control: "textarea" }] },
  { type: "remesh", category: "3D", label: "Remesh", description: "Retopologize a model with Meshy", presentation: { kind: "MESH", detail: "Remesh", tone: "rose" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { topology: "triangle", faceCount: 3e4 }, parameters: [{ key: "topology", label: "Topology", control: "segmented", options: topology }, { key: "faceCount", label: "Target Polycount", control: "slider", range: { min: 100, max: 3e5, step: 100 } }] },
  { type: "retexture", category: "3D", label: "Retexture", description: "Paint a new texture from text or a style image", presentation: { kind: "MATERIAL", detail: "Retexture", tone: "violet" }, inputs: { model: { type: "model" }, image: { type: "image" }, text: promptText }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { styleMode: "text", prompt: "", aiModel: "latest", textureQuality: "standard", pbr: true, enableOriginalUv: false }, parameters: [{ key: "styleMode", label: "Style", control: "segmented", options: [{ value: "text", label: "Text", inputs: [{ key: "prompt", label: "Style Prompt", control: "textarea" }] }, { value: "image", label: "Image" }] }, { key: "aiModel", label: "Meshy Model", control: "select", options: options([["latest", "Latest"], ["meshy-6", "Meshy 6"], ["meshy-7", "Meshy 7"], ["meshy-6-lite", "Meshy 6 Lite"]]) }, { key: "textureQuality", label: "Texture Resolution", control: "segmented", options: options([["standard", "2K"], ["detailed", "4K"], ["extreme", "8K"]]) }, { key: "pbr", label: "PBR", control: "toggle" }, { key: "enableOriginalUv", label: "Keep Original UVs", control: "toggle" }] },
  { type: "animation", category: "3D", label: "Animation", description: "Apply a library animation or a text-to-motion clip to a rig", presentation: { kind: "RIG", detail: "Animation", tone: "violet" }, inputs: { model: { type: "model", label: "Rig" }, motion: { type: "model", label: "Motion" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { actionId: 0, postProcess: "", fps: 30 }, parameters: [{ key: "actionId", label: "Animation", control: "select", options: options([[0, "Idle"], [-2, "Walking"], [-1, "Running"], [4, "Attack"], [25, "Agree"]]) }, { key: "postProcess", label: "Post Process", control: "select", options: [{ value: "", label: "None" }, { value: "change_fps", label: "Change FPS", inputs: [{ key: "fps", label: "FPS", control: "select", options: options([[24, "24"], [25, "25"], [30, "30"], [60, "60"]]) }] }, { value: "fbx2usdz", label: "FBX to USDZ" }, { value: "extract_armature", label: "Extract Armature" }] }] },
  { type: "text-to-motion", category: "3D", label: "Text to Motion", description: "Generate a motion clip from a description", presentation: { kind: "RIG", detail: "Text to motion", tone: "violet" }, inputs: { text: promptText }, outputs: { model: { type: "model", label: "Motion" } }, requires: ["text"], executable: true, defaults: { prompt: "", mode: "prime", duration: 3 }, parameters: [{ key: "prompt", label: "Prompt", control: "textarea" }, { key: "mode", label: "Mode", control: "segmented", options: options([["prime", "Prime"], ["swift", "Swift"]]) }, { key: "duration", label: "Duration (s)", control: "slider", range: { min: 2, max: 10, step: 0.5 } }] },
  { type: "convert-model", category: "Output", label: "Convert", description: "Convert a model to another format", presentation: { kind: "EXPORT", detail: "Format conversion", tone: "amber" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { targetFormat: "fbx" }, parameters: [{ key: "targetFormat", label: "Format", control: "select", options: options([["glb", "GLB"], ["fbx", "FBX"], ["obj", "OBJ"], ["usdz", "USDZ"], ["blend", "BLEND"], ["stl", "STL"], ["3mf", "3MF"]]) }] },
  { type: "resize-model", category: "3D", label: "Resize", description: "Scale a model to a real-world size", presentation: { kind: "MESH", detail: "Resize", tone: "cyan" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { resizeMode: "height", resizeHeight: 1, resizeLength: 1, originAt: "bottom" }, parameters: [{ key: "resizeMode", label: "Mode", control: "select", options: [{ value: "height", label: "Height", inputs: [{ key: "resizeHeight", label: "Height (m)", control: "slider", range: { min: 0.1, max: 5, step: 0.1 } }] }, { value: "longest", label: "Longest Side", inputs: [{ key: "resizeLength", label: "Length (m)", control: "slider", range: { min: 0.1, max: 5, step: 0.1 } }] }, { value: "auto", label: "Auto Size", inputs: [{ key: "originAt", label: "Origin", control: "select", options: options([["bottom", "Bottom"], ["center", "Center"]]) }] }] }] },
  { type: "uv-unwrap", category: "3D", label: "UV Unwrap", description: "Build a clean UV layout for a GLB", presentation: { kind: "MATERIAL", detail: "UV unwrap", tone: "violet" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: {}, parameters: [] },
  { type: "print-analyze", category: "Print", label: "Print Check", description: "Check a model for FDM printability", presentation: { kind: "CHECK", detail: "Print analysis", tone: "cyan" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, defaults: {}, parameters: [] },
  { type: "print-repair", category: "Print", label: "Print Repair", description: "Repair a mesh for FDM printing", presentation: { kind: "MESH", detail: "Print repair", tone: "rose" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: {}, parameters: [] },
  { type: "multi-color-print", category: "Print", label: "Multi-color Print", description: "Export a multi-color 3MF for a slicer", presentation: { kind: "EXPORT", detail: "Multi-color 3MF", tone: "amber" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { printerBrand: "bambu" }, parameters: [{ key: "printerBrand", label: "Printer", control: "select", options: printerBrands }] },
  { type: "auto-split", category: "Print", label: "Auto Split", description: "Split a Meshy 6 or 7 model into printable parts", presentation: { kind: "SEGMENTS", detail: "Auto split", tone: "cyan" }, inputs: { model: { type: "model" }, text: promptText }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { splitMode: "auto", prompt: "", layout: "assembled", connectors: false, connectorType: "cube" }, parameters: [{ key: "splitMode", label: "Split", control: "select", options: [{ value: "auto", label: "Auto" }, { value: "by_parts", label: "By Parts", inputs: [{ key: "prompt", label: "Parts", control: "textarea" }] }, { value: "by_color", label: "By Color", inputs: [{ key: "prompt", label: "Colors", control: "textarea" }] }] }, { key: "layout", label: "Layout", control: "segmented", options: options([["assembled", "Assembled"], ["on_plate", "On Plate"]]) }, { key: "connectors", label: "Connectors", control: "toggle", options: [{ value: true, label: "On", inputs: [{ key: "connectorType", label: "Connector", control: "segmented", options: options([["cube", "Cube"], ["cylinder", "Cylinder"]]) }] }] }] },
  { type: "creative-lab", category: "3D", label: "Creative Lab", description: "Turn a photo into a printable product", presentation: { kind: "3D MODEL", detail: "Creative Lab", tone: "green" }, inputs: { image: { type: "image" } }, outputs: { model: { type: "model" } }, requires: ["image"], executable: true, modelEditor: true, defaults: { product: "keychain", nameText: "" }, parameters: [{ key: "product", label: "Product", control: "select", options: [{ value: "keychain", label: "Keychain", inputs: [{ key: "nameText", label: "Engraving", control: "text", placeholder: "Up to 10 characters" }] }, { value: "fridge-magnet", label: "Fridge Magnet" }, { value: "figure", label: "Figure" }, { value: "vinyl-figure", label: "Vinyl Figure" }, { value: "brick-figure", label: "Brick Figure" }, { value: "lamp", label: "Lamp" }, { value: "keycap", label: "Keycap" }, { value: "fidget-pixel", label: "Fidget Pixel" }, { value: "fidget-collapsible", label: "Collapsible Fidget" }] }] }
];
var canvasNodeDefinitions = [
  { type: "frame", category: "Annotate", label: "Section", description: "Group related canvas steps", presentation: { kind: "SECTION", detail: "Canvas group", tone: "slate" }, inputs: {}, outputs: {}, defaults: {}, parameters: [] },
  // No upload defaults: what the user uploaded lives in `uploadAssets`, not in
  // config (see UPLOAD_KEYS). An empty default would only migrate back into it.
  { type: "reference-image", category: "Input", label: "Asset Upload", description: "Add an image or 3D model input", presentation: { kind: "INPUT", detail: "Reference asset", tone: "cyan" }, inputs: {}, outputs: { image: { type: "image", label: "Image" }, model: { type: "model", label: "Model" } }, modelEditor: true, defaults: {}, parameters: [] },
  // Result nodes present what a run produced. They are hidden from Add node:
  // a run creates them, and they carry the artifact in generatedAssets.
  { type: "generated-image", category: "Output", label: "Asset Preview", description: "Preview an image created by a canvas step", presentation: { kind: "OUTPUT", detail: "Generated asset", tone: "amber" }, inputs: { image: { type: "image" } }, outputs: { image: { type: "image" } }, hidden: true, defaults: {}, parameters: [] },
  { type: "generated-model", category: "Output", label: "Asset Preview", description: "Preview a 3D model created by a canvas step", presentation: { kind: "OUTPUT", detail: "Generated asset", tone: "green" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, hidden: true, modelEditor: true, defaults: {}, parameters: [] },
  { type: "generated-export", category: "Output", label: "Asset Preview", description: "Preview an exported asset from a canvas step", presentation: { kind: "OUTPUT", detail: "Generated asset", tone: "amber" }, inputs: {}, outputs: {}, hidden: true, defaults: {}, parameters: [] },
  { type: "prompt", category: "Input", label: "Text Prompt", description: "Set creative direction", presentation: { kind: "PROMPT", detail: "Creative direction", tone: "violet" }, inputs: {}, outputs: { text: { type: "text" } }, defaults: { prompt: "Production-ready stylized 3D asset" }, parameters: [{ key: "prompt", label: "Prompt", control: "textarea" }] },
  { type: "generate-image", category: "2D", label: "Gen Image", description: "Create concept images", presentation: { kind: "IMAGE", detail: "Concept generation", tone: "amber" }, inputs: { image: { type: "image" }, text: promptText }, outputs: { image: { type: "image" } }, requires: [["image", "text"]], executable: true, defaults: { modelVersion: "gemini_2.5_flash_image_preview", amount: 4, scale: "1:1", tPose: false }, parameters: [{ key: "modelVersion", label: "Image Model", control: "select", options: imageModels }, { key: "amount", label: "Images", control: "select", options: imageAmounts }, { key: "scale", label: "Aspect Ratio", control: "select", options: scales }, { key: "tPose", label: "T-Pose", control: "toggle" }] },
  { type: "image-decomposition", category: "2D", label: "Image Decomposition", description: "Break an image into editable visual parts", presentation: { kind: "DECOMPOSE", detail: "Image parts", tone: "cyan" }, inputs: { image: { type: "image" } }, outputs: { image: { type: "image" } }, requires: ["image"], executable: true, defaults: { modelVersion: "gemini_2.5_flash_image_preview", prompt: "", amount: 4, scale: "1:1", resolution: "1K", templateKey: "asset_extraction" }, parameters: [{ key: "modelVersion", label: "Image Model", control: "select", options: imageModels }, { key: "prompt", label: "Prompt", control: "textarea", placeholder: "Optional extraction instructions" }, { key: "amount", label: "Outputs", control: "select", options: imageAmounts }, { key: "scale", label: "Aspect Ratio", control: "select", options: scales }, { key: "resolution", label: "Resolution", control: "select", options: options([["1K", "1K"], ["2K", "2K"], ["4K", "4K"]]) }] },
  { type: "generate-multiview-images", category: "2D", label: "Generate Multi-view Images", description: "Create front, back, left, and right views from references", presentation: { kind: "MULTI-VIEW", detail: "Four-view generation", tone: "amber" }, inputs: { image: { type: "image" }, text: promptText }, outputs: multiViewImages, requires: [["image", "text"]], executable: true, defaults: {}, parameters: [] },
  // `approved` is not a default: it records that this run was let through by
  // hand, which makes it a result and puts it in generatedAssets (see OUTPUT_KEYS).
  { type: "review", category: "Annotate", label: "Check", description: "Pause to check the image before continuing", presentation: { kind: "CHECK", detail: "Approval gate", tone: "rose" }, inputs: { image: { type: "image" } }, outputs: { image: { type: "image" } }, requires: ["image"], executable: true, defaults: { instruction: "Review the generated image before continuing." }, parameters: [] },
  ...["generate-model", "multiview-to-3d", "text-to-3d"].map((type) => ({ type, category: "3D", label: type === "generate-model" ? "Gen HD Model" : type === "multiview-to-3d" ? "Multi-view to 3D" : "Text to 3D", description: type === "generate-model" ? "Turn an image or text prompt into a model" : type === "multiview-to-3d" ? "Turn four labeled image views into a 3D model" : "Turn a text prompt into a model", presentation: { kind: "3D MODEL", detail: type === "generate-model" ? "Image or text to 3D" : type === "multiview-to-3d" ? "Four-view reconstruction" : "Text to 3D", tone: "green" }, inputs: type === "text-to-3d" ? { text: promptText } : type === "multiview-to-3d" ? multiViewImages : { image: multiImage, ...multiViewImages, text: promptText }, outputs: { model: { type: "model" } }, requires: type === "text-to-3d" ? ["text"] : type === "multiview-to-3d" ? viewKeys : [["image", ...viewKeys, "text"]], executable: true, modelEditor: true, defaults: { ...modelDefaults }, parameters: modelParameters, effects: modelEffects })),
  { type: "smart-mesh", category: "3D", label: "Smart Mesh", description: "Generate a mesh from an image or text prompt", presentation: { kind: "3D MODEL", detail: "Smart mesh generation", tone: "green" }, inputs: { image: multiImage, text: promptText }, outputs: { model: { type: "model" } }, requires: [["image", "text"]], executable: true, modelEditor: true, defaults: { topology: "triangle", faceCount: 5e3 }, parameters: [{ key: "faceCount", label: "Polycount", control: "slider", range: { min: 500, max: 2e4, step: 500 } }] },
  { type: "retopology", category: "3D", label: "Retopology", description: "Optimize model geometry", presentation: { kind: "MESH", detail: "Geometry optimization", tone: "rose" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { topology: "quad", smartPoly: false, faceLimit: 1e4 }, parameters: [{ key: "topology", label: "Topology", control: "segmented", options: retopologyTopology }, { key: "smartPoly", label: "Smart Low Poly v2", control: "toggle" }, { key: "faceLimit", label: "Polygon Count", control: "slider", range: { min: 500, max: 5e4, step: 500 } }] },
  { type: "texture", category: "3D", label: "UV Texture", description: "Create UV textures from a model, image, or text", presentation: { kind: "MATERIAL", detail: "UV texture generation", tone: "violet" }, inputs: { model: { type: "model" }, image: { type: "image" }, text: promptText }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { inputMode: "imageGenerate", prompt: "", textureQuality: "extreme", textureStyle: "None" }, parameters: [{ key: "inputMode", label: "Input", control: "segmented", options: [{ value: "imageGenerate", label: "Image" }, { value: "multiViewGenerate", label: "Model" }, { value: "textGenerate", label: "Text", inputs: [{ key: "prompt", label: "Prompt", control: "textarea" }] }] }, { key: "textureStyle", label: "Create Your Own Texture Style", control: "select", options: options(["None", "Mecha Pop", "Heritage", "Mecha", "Wood", "Custom"].map((value) => [value, value])) }, { key: "textureQuality", label: "Texture Resolution", control: "segmented", options: textureQualities }] },
  { type: "rigging", category: "3D", label: "Rigging", description: "Add a skeleton to a model", presentation: { kind: "RIG", detail: "Auto rigging", tone: "violet" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { modelVersion: "v2.5-20260210" }, parameters: [{ key: "modelVersion", label: "AI Model", control: "select", options: options([["v2.5-20260210", "v2.5 \xB7 Good for Animals"], ["v1.0-20240301", "v1.0 \xB7 Good for Humanoid"]]) }] },
  { type: "segments", category: "3D", label: "Segments", description: "Segment a model into parts", presentation: { kind: "SEGMENTS", detail: "Part segmentation", tone: "cyan" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { detailLevel: "low" }, parameters: [{ key: "detailLevel", label: "Detail Level", control: "segmented", options: detailLevels }] },
  { type: "model-preview", category: "3D", label: "Asset Preview", description: "Review a 3D asset", presentation: { kind: "REVIEW", detail: "Interactive preview", tone: "cyan" }, inputs: { model: { type: "model" } }, outputs: { model: { type: "model" } }, requires: ["model"], executable: true, modelEditor: true, defaults: { materialMode: "standard", shading: "smooth", pbrPreview: false, metallic: 0, roughness: 1, wireframe: false }, parameters: [{ key: "materialMode", label: "View Mode", control: "select", options: [{ value: "matcap", label: "Solid View" }, { value: "standard", label: "Textured View", inputs: [{ key: "pbrPreview", label: "PBR", control: "toggle", options: [{ value: true, label: "On", inputs: [{ key: "metallic", label: "Metallic", control: "slider", range: { min: 0, max: 1, step: 0.01 } }, { key: "roughness", label: "Roughness", control: "slider", range: { min: 0, max: 1, step: 0.01 } }] }] }] }, { value: "normal", label: "Normal" }, { value: "unlit", label: "Unlit" }, { value: "cartoon", label: "Cartoon Style" }, { value: "sketch", label: "Sketch Style" }, { value: "hologram", label: "Hologram Style" }] }, { key: "shading", label: "Shading", control: "select", options: options([["flat", "Flat"], ["smooth", "Smooth"]]) }, { key: "wireframe", label: "Wireframe", control: "toggle" }] },
  { type: "export-model", category: "Output", label: "Export", description: "Export an image or 3D model", presentation: { kind: "EXPORT", detail: "Export image or 3D model", tone: "amber" }, inputs: { image: { type: "image" }, model: { type: "model" } }, outputs: {}, requires: [["image", "model"]], executable: true, modelEditor: true, defaults: { fileName: "shark-gardener", modelFormat: "gltf", fbxPreset: "blender", textureSize: 2048, withAnimation: false, packUV: false, animateInPlace: false, exportVertexColors: false }, parameters: [{ key: "fileName", label: "File Name", control: "text" }, { key: "modelFormat", label: "Format", control: "select", options: [{ value: "usdz", label: "USD" }, { value: "fbx", label: "FBX", inputs: [{ key: "fbxPreset", label: "FBX Preset", control: "select", options: options([["blender", "Blender"], ["mixamo", "Mixamo"], ["3dsmax", "3ds Max"]]) }] }, { value: "obj", label: "OBJ", inputs: [{ key: "exportVertexColors", label: "Export Vertex Colors", control: "toggle" }] }, { value: "stl", label: "STL" }, { value: "gltf", label: "GLB" }, { value: "3mf", label: "3MF" }] }, { key: "textureSize", label: "Texture Resolution", control: "select", options: options([[512, "512"], [1024, "1K"], [2048, "2K"], [4096, "4K"], [8192, "8K"]]) }, { key: "withAnimation", label: "Export Skeleton", control: "toggle", options: [{ value: true, label: "On", inputs: [{ key: "animateInPlace", label: "Animation Stay in Place", control: "toggle" }] }] }, { key: "packUV", label: "Pack UV", control: "toggle" }] },
  ...meshyApiNodes
];
var RESULT_NODE_TYPES = /* @__PURE__ */ new Set(["generated-image", "generated-model", "generated-export"]);
var INPUT_NODE_TYPES = /* @__PURE__ */ new Set(["reference-image", "prompt"]);
function nodeRoleFor(node) {
  if (node.type === "frame") return "container";
  if (RESULT_NODE_TYPES.has(node.type)) return "result";
  if (INPUT_NODE_TYPES.has(node.type)) return "input";
  return "execution";
}
var canvasNodeSchema = canvasNodeDefinitions.map((node) => ({ ...node, role: nodeRoleFor(node) }));
var canvasNodeSchemas = Object.fromEntries(canvasNodeSchema.map((node) => [node.type, node]));
var modelInputModeParameter = {
  key: "inputMode",
  label: "Mode",
  control: "segmented",
  options: [
    { value: "images", label: "Images" },
    { value: "views", label: "Views" }
  ]
};
function nodeSchema(type, provider = "tripo") {
  const schema = canvasNodeSchemas[type];
  if (!schema) return schema;
  let next = schema;
  if (provider === "meshy" && (type === "generate-model" || type === "multiview-to-3d" || type === "text-to-3d")) {
    next = { ...schema, defaults: meshyModelDefaults, parameters: meshyModelParameters, effects: void 0 };
  } else if (provider === "meshy" && type === "rigging") {
    next = { ...schema, defaults: { heightMeters: 1.7 }, parameters: meshyRigParameters, effects: void 0 };
  }
  if (type !== "generate-model") return next;
  return {
    ...next,
    defaults: { ...next.defaults, inputMode: "images" },
    parameters: [modelInputModeParameter, ...next.parameters]
  };
}
function nodeDefaults(type, provider = "tripo") {
  return structuredClone(nodeSchema(type, provider)?.defaults || {});
}
function isExecutableNodeType(type) {
  return Boolean(nodeSchema(type)?.executable);
}
function nodeRole(type) {
  return nodeSchema(type)?.role;
}
function isResultNodeType(type) {
  return nodeRole(type) === "result";
}
var GENERATED_KEYS = /* @__PURE__ */ new Set(["approved", "preview", "previews", "result", "runBatch", "selectedPreview", "viewPreviews"]);
var UPLOAD_KEYS = /* @__PURE__ */ new Set(["assetType", "assetUrl", "modelUrl", "reference", "thumbnailUrl"]);
function splitNodeTrees(config = {}, uploadAssets = {}, generatedAssets = {}, outputResult = {}) {
  const nextConfig = {};
  const nextUploads = { ...uploadAssets };
  const nextGenerated = { ...outputResult, ...generatedAssets };
  for (const [key, value] of Object.entries(config)) {
    const target = GENERATED_KEYS.has(key) ? nextGenerated : UPLOAD_KEYS.has(key) ? nextUploads : null;
    if (target) {
      if (!(key in target)) target[key] = value;
      continue;
    }
    nextConfig[key] = value;
  }
  return { config: nextConfig, uploadAssets: nextUploads, generatedAssets: nextGenerated };
}
function normalizeGeneratedAssets(type, generatedAssets = {}) {
  const normalized = { ...generatedAssets };
  if (typeof normalized.preview === "string" && legacyPreviewPaths.has(normalized.preview)) delete normalized.preview;
  if (Array.isArray(normalized.previews) && normalized.previews.every((preview) => typeof preview === "string" && legacyPreviewPaths.has(preview))) delete normalized.previews;
  if (normalized.viewPreviews && typeof normalized.viewPreviews === "object" && Object.values(normalized.viewPreviews).every((preview) => typeof preview === "string" && legacyPreviewPaths.has(preview))) delete normalized.viewPreviews;
  if (type === "generate-image" && Array.isArray(normalized.previews) && !normalized.previews.includes(normalized.selectedPreview)) normalized.selectedPreview = normalized.previews[0] || null;
  return normalized;
}
function normalizeNodeConfig(type, config = {}, provider = "tripo") {
  const normalized = { ...nodeDefaults(type, provider), ...config };
  const schema = nodeSchema(type, provider);
  if (provider === "meshy" && type === "generate-model") {
    if (!config.modelType) normalized.modelType = config.aiModel === "meshy-t2" || config.aiModel === "meshy-t2.5" ? "smart-topology" : "standard";
    if (config.shouldRemesh === void 0 && normalized.modelType === "standard") {
      const faceCount = Number(config.faceCount);
      normalized.shouldRemesh = config.topology === "quad" || faceCount >= 100 && faceCount <= 3e5;
    }
    if (normalized.modelType === "smart-topology" && normalized.aiModel !== "meshy-t2" && normalized.aiModel !== "meshy-t2.5") normalized.aiModel = "meshy-t2.5";
  }
  for (const parameter of visibleParameters(schema?.parameters, normalized)) {
    if (parameter.control !== "select" || !parameter.options?.length) continue;
    if (!parameter.options.some((option) => option.value === normalized[parameter.key])) normalized[parameter.key] = schema.defaults[parameter.key] ?? parameter.options[0].value;
  }
  if (provider !== "meshy" && ["generate-model", "multiview-to-3d", "text-to-3d"].includes(type)) {
    if (config.quality && !config.modelVersion) normalized.modelVersion = config.quality === "standard" ? "v3.0-20250812" : config.quality;
    if (config.modelVersion === "Smart Mesh") normalized.modelVersion = modelDefaults.modelVersion;
    if (typeof config.geometryQuality === "string") normalized.geometryQuality = config.geometryQuality === "detailed";
    if (config.faceType && !config.topology) normalized.topology = String(config.faceType).toLowerCase() === "quad" ? "quad" : "triangle";
  }
  if (type === "retopology") {
    if (config.targetFaces && !config.faceLimit) normalized.faceLimit = config.targetFaces;
    if (config.faceType && !config.topology) normalized.topology = String(config.faceType).toLowerCase() === "quad" ? "quad" : "triangle";
  }
  if (type === "texture") {
    if (!config.textureQuality && typeof config.resolution === "string") normalized.textureQuality = { "2K": "standard", "4K": "detailed", "8K": "extreme" }[config.resolution.toUpperCase()] || "standard";
    delete normalized.model;
    delete normalized.resolution;
    delete normalized.style;
  }
  if (type === "model-preview") delete normalized.background;
  if (type === "export-model") {
    if (config.format && !config.modelFormat) normalized.modelFormat = String(config.format).toLowerCase() === "glb" ? "gltf" : String(config.format).toLowerCase();
    if (String(config.modelFormat).toLowerCase() === "glb") normalized.modelFormat = "gltf";
  }
  return normalized;
}
function conditionsMatch(conditions, config) {
  return !conditions || conditions.every((condition) => config[condition.field] === condition.equals);
}
function allParameters(parameters) {
  const list = [];
  const walk = (items) => {
    for (const parameter of items) {
      list.push(parameter);
      for (const option of parameter.options || []) if (option.inputs?.length) walk(option.inputs);
    }
  };
  if (parameters) walk(parameters);
  return list;
}
function visibleParameters(parameters, config) {
  const list = [];
  const walk = (items) => {
    for (const parameter of items) {
      list.push(parameter);
      const selected = parameter.options?.find((option) => option.value === config[parameter.key]);
      if (selected?.inputs?.length) walk(selected.inputs);
    }
  };
  if (parameters) walk(parameters);
  return list;
}
function parameterRange(parameter, config) {
  if (!parameter.range) return void 0;
  const range = { min: parameter.range.min, max: parameter.range.max, step: parameter.range.step };
  for (const rule of parameter.range.rules || []) {
    if (!conditionsMatch(rule.when, config)) continue;
    if (rule.min !== void 0) range.min = rule.min;
    if (rule.max !== void 0) range.max = rule.max;
  }
  return range;
}
function applyNodeParameter(type, config, key, value, provider = "tripo") {
  const next = { ...config, [key]: value };
  for (const effect of nodeSchema(type, provider)?.effects || []) {
    if (effect.when.field === key && value === effect.when.equals) Object.assign(next, effect.set);
  }
  return next;
}

// packages/canvas-core/src/canvas-nodes.ts
var nodeCatalog = canvasNodeSchema;
var nodeCategories = [...new Set(nodeCatalog.map((node) => node.category))];
function nodeDefinition(type) {
  return nodeCatalog.find((item) => item.type === type);
}
function toPortList(ports) {
  return Object.entries(ports || {}).map(([id, port]) => ({
    ...port,
    id,
    label: port.label || id[0].toUpperCase() + id.slice(1)
  }));
}
function nodeInputPorts(type) {
  return toPortList(nodeDefinition(type)?.inputs);
}
var namedViewPortIds = ["front", "back", "left", "right"];
function modelInputMode(config) {
  return config?.inputMode === "views" ? "views" : "images";
}
function activeInputPorts(type, config) {
  const ports = nodeInputPorts(type);
  if (type !== "generate-model") return ports;
  const hidden = new Set(modelInputMode(config) === "views" ? ["image"] : namedViewPortIds);
  return ports.filter((port) => !hidden.has(port.id));
}
function nodeOutputPorts(type) {
  return toPortList(nodeDefinition(type)?.outputs);
}
function referenceAssetKind(uploadAssets) {
  if (!uploadAssets) return null;
  if (uploadAssets.assetType === "model") return "model";
  if (uploadAssets.assetType === "image") return "image";
  if (typeof uploadAssets.modelUrl === "string" && uploadAssets.modelUrl) return "model";
  if (typeof uploadAssets.assetUrl === "string" && uploadAssets.assetUrl) return "image";
  return null;
}
function resolveEdgePorts(sourceType, targetType, edge) {
  const sourcePorts = sourceType ? nodeOutputPorts(sourceType) : [];
  const targetPorts = targetType ? nodeInputPorts(targetType) : [];
  const sourcePort = sourcePorts.find((port) => port.id === edge.source?.port) || (!edge.source?.port || edge.source.port === "output" ? sourcePorts[0] : void 0);
  const targetPort = targetPorts.find((port) => port.id === edge.target?.port) || (!edge.target?.port || edge.target.port === "input" ? targetPorts.find((port) => sourcePort && (sourcePort.type === "any" || port.type === "any" || port.type === sourcePort.type)) : void 0);
  return sourcePort && targetPort ? { sourcePort, targetPort } : null;
}
function resolveEdgePortPairs(sourceType, targetType, edge) {
  const pair = resolveEdgePorts(sourceType, targetType, edge);
  if (!pair || !sourceType) return [];
  const named = edge.source?.port && edge.source.port !== "output";
  if (named || !pair.targetPort.multiple) return [pair];
  return nodeOutputPorts(sourceType).filter((sourcePort) => sourcePort.type === "any" || pair.targetPort.type === "any" || sourcePort.type === pair.targetPort.type).map((sourcePort) => ({ sourcePort, targetPort: pair.targetPort }));
}
function nodeOutputPortValues(node, produced) {
  const uploads = node.uploadAssets || {};
  const output = node.generatedAssets || {};
  if (node.type === "reference-image") {
    const kind = referenceAssetKind(uploads);
    const raw = kind === "model" ? uploads.modelUrl ?? uploads.assetUrl : kind === "image" ? uploads.assetUrl ?? output.preview : null;
    const value = typeof raw === "string" ? raw.trim() : raw;
    return kind && value ? { [kind]: value } : {};
  }
  const ports = nodeOutputPorts(node.type);
  if (!ports.length) return {};
  const fromPorts = produced?.ports || null;
  const values = {};
  const config = node.config || {};
  const viewPreviews = output.viewPreviews || {};
  const previews = Array.isArray(output.previews) ? output.previews : [];
  for (const port of ports) {
    if (fromPorts && fromPorts[port.id] != null) {
      values[port.id] = fromPorts[port.id];
      continue;
    }
    const fallback = port.type === "model" ? produced?.modelUrl ?? uploads.modelUrl ?? output.modelUrl : port.type === "text" ? produced?.text ?? config.prompt : viewPreviews[port.id] ?? produced?.preview ?? output.selectedPreview ?? output.preview ?? previews[0];
    const value = typeof fallback === "string" ? fallback.trim() : fallback;
    if (value != null && value !== "") values[port.id] = value;
  }
  return values;
}
function resolveInputSources(node, canvas) {
  const byId = new Map(canvas.nodes.map((item) => [item.id, item]));
  const sources = {};
  for (const port of nodeInputPorts(node.type)) sources[port.id] = [];
  for (const edge of canvas.edges || []) {
    if (edge.target?.nodeId !== node.id) continue;
    const source = byId.get(edge.source?.nodeId || "");
    if (!source) continue;
    for (const pair of resolveEdgePortPairs(source.type, node.type, edge)) {
      const found = sources[pair.targetPort.id];
      if (!found || found.some((item) => item.node.id === source.id && item.portId === pair.sourcePort.id)) continue;
      found.push({ node: source, portId: pair.sourcePort.id });
    }
  }
  return sources;
}
function resolveNodeInputs(node, canvas, producedByNodeId = /* @__PURE__ */ new Map()) {
  const produced = producedByNodeId instanceof Map ? producedByNodeId : new Map(Object.entries(producedByNodeId));
  const sources = resolveInputSources(node, canvas);
  const resolved = {};
  for (const port of nodeInputPorts(node.type)) {
    const values = [];
    for (const source of sources[port.id] || []) {
      const value = nodeOutputPortValues(source.node, produced.get(source.node.id))[source.portId];
      if (value != null && !values.includes(value)) values.push(value);
    }
    if (!values.length && port.fallbackConfig) {
      const fallback = node.config?.[port.fallbackConfig];
      if (typeof fallback === "string" ? fallback.trim() : fallback != null) values.push(fallback);
    }
    if (values.length) resolved[port.id] = port.multiple ? values : values[0];
  }
  return resolved;
}
function parameterLabel(type, key) {
  const port = nodeInputPorts(type).find((candidate) => candidate.id === key);
  if (port) return port.label;
  const parameter = allParameters(nodeSchema(type)?.parameters).find((candidate) => candidate.key === key);
  return parameter?.label || key[0].toUpperCase() + key.slice(1);
}
function labelChoices(labels) {
  if (labels.length > 2) return `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1)}`;
  return labels.length === 2 ? `${labels[0]} or ${labels[1]}` : labels[0];
}
var hasValue = (value) => typeof value === "string" ? Boolean(value.trim()) : value != null;
function validateCanvasGraph(nodes, edges, { requireParameters = false } = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const issues = [];
  const inputCounts = /* @__PURE__ */ new Map();
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const source = byId.get(edge.source?.nodeId || "");
    const target = byId.get(edge.target?.nodeId || "");
    const ports = source && target ? resolveEdgePorts(source.type, target.type, edge) : null;
    const { sourcePort, targetPort } = ports || {};
    if (!source || !target || !sourcePort || !targetPort) {
      issues.push({ nodeId: target?.id, port: edge.target?.port, code: "invalid_edge", message: "Connection references a node or port that does not exist." });
      continue;
    }
    if (sourcePort.type !== "any" && targetPort.type !== "any" && targetPort.type !== sourcePort.type) {
      issues.push({ nodeId: target.id, port: targetPort.id, code: "incompatible_ports", message: `${targetPort.label} accepts ${targetPort.type}, not ${sourcePort.type}.` });
      continue;
    }
    const key = `${target.id}:${targetPort.id}`;
    inputCounts.set(key, (inputCounts.get(key) || 0) + 1);
    if (!targetPort.multiple && inputCounts.get(key) > 1) {
      issues.push({ nodeId: target.id, port: targetPort.id, code: "duplicate_input", message: `${targetPort.label} accepts only one connection.` });
    }
    outgoing.get(source.id)?.push(target.id);
  }
  if (requireParameters) {
    const scope = typeof requireParameters === "boolean" ? null : new Set(requireParameters);
    for (const node of nodes) {
      if (scope && !scope.has(node.id)) continue;
      const ports = new Map(nodeInputPorts(node.type).map((port) => [port.id, port]));
      const satisfied = (key) => {
        const port = ports.get(key);
        if (!port) return hasValue(node.config?.[key]);
        if (inputCounts.get(`${node.id}:${key}`)) return true;
        return port.fallbackConfig ? hasValue(node.config?.[port.fallbackConfig]) : false;
      };
      for (const requirement of nodeSchema(node.type)?.requires || []) {
        const keys = Array.isArray(requirement) ? requirement : [requirement];
        if (keys.some(satisfied)) continue;
        const choices = labelChoices(keys.map((key) => parameterLabel(node.type, key)));
        issues.push({ nodeId: node.id, parameter: keys[0], code: "required_parameter_missing", message: `${node.name || node.type} requires ${choices}.` });
      }
    }
  }
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cyclic = outgoing.get(id)?.some(visit);
    visiting.delete(id);
    visited.add(id);
    return Boolean(cyclic);
  };
  if (nodes.some((node) => visit(node.id))) issues.push({ code: "cycle", message: "Canvas connections must not contain a cycle." });
  return issues;
}

// packages/canvas-core/src/canvas-graph.ts
var nodePresentation = Object.fromEntries(nodeCatalog.map((node) => [node.type, [node.presentation.kind, node.presentation.detail, node.presentation.tone]]));

// packages/canvas-core/src/canvas-results.ts
var MULTI_VIEW_KEYS = ["front", "back", "left", "right"];
var VIEW_LABELS = { front: "Front", back: "Back", left: "Left", right: "Right" };
var DEFAULT_IMAGE_COUNT = 1;
var EXPORT_RESULT = "Export file";
function mediaPorts(type) {
  return nodeOutputPorts(type).filter((port) => port.type === "image" || port.type === "model");
}
function imageSpec(index, count, view) {
  return {
    type: "generated-image",
    slot: view ? `view:${view}` : `image:${index}`,
    name: view ? `${VIEW_LABELS[view]} view` : count > 1 ? `Image ${index + 1}` : "Image",
    produces: "image",
    ...view ? { view } : {}
  };
}
function imageCount(config) {
  const amount = Number(config?.amount);
  return Number.isInteger(amount) && amount > 0 ? amount : DEFAULT_IMAGE_COUNT;
}
function resultSpecs(type, config) {
  if (!isExecutableNodeType(type)) return [];
  const views = MULTI_VIEW_KEYS.filter((key) => nodeOutputPorts(type).some((port) => port.id === key));
  if (type === "export-model") {
    return [{ type: "generated-export", slot: "export", name: EXPORT_RESULT, produces: "model" }];
  }
  if (views.length) return views.map((view) => imageSpec(0, 1, view));
  const media = mediaPorts(type);
  if (media.some((port) => port.type === "model")) {
    return [{ type: "generated-model", slot: "model", name: "Model", produces: "model" }];
  }
  if (!media.length) return [];
  const count = imageCount(config);
  return Array.from({ length: count }, (_, index) => imageSpec(index, count));
}
function isResultType(type) {
  return nodeRole(type) === "result";
}

// packages/canvas-core/src/canvas-result-slots.ts
var COLUMN_GAP = 340;
var ROW_GAP = 270;
function shapeOf(canvas) {
  return canvas.nodes.some((node) => node.type === "canvas") ? "canvas" : "domain";
}
function typeOf(node, shape) {
  return shape === "canvas" ? node.data?.canvasType || node.type : node.type;
}
function configOf(node, shape) {
  return (shape === "canvas" ? node.data?.config : node.config) || {};
}
function generatedOf(node, shape) {
  return (shape === "canvas" ? node.data?.generatedAssets : node.generatedAssets) || {};
}
function setGenerated(node, shape, generated) {
  if (shape === "canvas") node.data = { ...node.data, generatedAssets: generated };
  else node.generatedAssets = generated;
}
function positionOf(node, shape) {
  if (shape === "canvas") return node.position || { x: 0, y: 0 };
  const ui = node.ui || {};
  return ui.position || { x: 0, y: 0 };
}
function setPosition(node, shape, position) {
  if (shape === "canvas") node.position = position;
  else node.ui = { ...node.ui || {}, position };
}
function parentOf(node, shape) {
  if (shape === "canvas") return node.parentNode;
  return node.ui?.parentFrameId;
}
function stageOf(node, shape) {
  const origin = generatedOf(node, shape).resultOf;
  return origin?.sourceId || null;
}
function edgesOf(canvas, shape) {
  return (canvas.edges || []).map((edge) => shape === "canvas" ? { ...edge, source: { nodeId: edge.source, port: edge.sourceHandle || "output" }, target: { nodeId: edge.target, port: edge.targetHandle || "input" } } : edge);
}
function sameSpec(node, shape, spec) {
  const generated = generatedOf(node, shape);
  if (typeof generated.slot === "string") return generated.slot === spec.slot;
  return typeOf(node, shape) === spec.type;
}
function downstreamOf(startId, edges) {
  const found = /* @__PURE__ */ new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.source?.nodeId !== current || found.has(edge.target.nodeId)) continue;
      found.add(edge.target.nodeId);
      queue.push(edge.target.nodeId);
    }
  }
  found.delete(startId);
  return found;
}
function outputPortOf(type) {
  return nodeOutputPorts(type)[0];
}
function inputPortOf(type) {
  return nodeInputPorts(type)[0];
}
function mediaPair(sourceType, targetType) {
  const source = nodeOutputPorts(sourceType).find((port) => port.type === "image" || port.type === "model");
  const target = nodeInputPorts(targetType).find((port) => port.id === source?.id) || nodeInputPorts(targetType).find((port) => source && (port.type === source.type || port.type === "any"));
  return source && target ? { sourcePort: source.id, targetPort: target.id, multiple: Boolean(target.multiple) } : null;
}
function reconcileResultSlots(canvas, { filled = /* @__PURE__ */ new Map(), materialize = null } = {}) {
  const shape = shapeOf(canvas);
  const provider = canvas.provider || "tripo";
  const edges = edgesOf(canvas, shape);
  const taken = new Set(canvas.nodes.map((node) => node.id));
  const added = [];
  const removed = [];
  const materialized = [];
  const nodes = canvas.nodes.slice();
  const all = () => [...nodes, ...added];
  const byId = /* @__PURE__ */ new Map();
  for (const node of all()) byId.set(node.id, node);
  const typeById = (id) => {
    const node = byId.get(id);
    return node ? typeOf(node, shape) || "" : "";
  };
  const owned = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (!isResultType(typeOf(node, shape) || "")) continue;
    const stage = stageOf(node, shape);
    if (!stage) continue;
    owned.set(stage, [...owned.get(stage) || [], node]);
  }
  const wanted = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const type = typeOf(node, shape) || "";
    if (nodeRole(type) !== "execution") continue;
    const specs = resultSpecs(type, normalizeNodeConfig(type, configOf(node, shape), provider));
    const existing = owned.get(node.id) || [];
    const keep = [];
    for (const spec of specs) {
      const match = existing.find((slot2) => sameSpec(slot2, shape, spec));
      if (match) {
        keep.push(match);
        continue;
      }
      const slot = createSlot(canvas, shape, node, type, spec, taken, filled.get(node.id), materialize);
      added.push(slot);
      byId.set(slot.id, slot);
      keep.push(slot);
      materialized.push(slot.id);
    }
    for (const slot of existing) if (!keep.includes(slot)) removed.push(slot.id);
    wanted.set(node.id, keep);
  }
  const baseEdges = edges.filter((edge) => !isResultType(typeById(edge.source?.nodeId || "")) && !isResultType(typeById(edge.target?.nodeId || "")));
  for (const [stageId, slots] of wanted) {
    const stage = byId.get(stageId);
    if (!stage || !slots.length) continue;
    const stageX = positionOf(stage, shape).x;
    const feeds = [...downstreamOf(stageId, baseEdges)].map((id) => byId.get(id)).filter((node) => Boolean(node)).map((node) => positionOf(node, shape).x).filter((x) => x > stageX);
    const targetX = feeds.length ? Math.min(...feeds) : Infinity;
    if (targetX < stageX + COLUMN_GAP * 2) {
      const push = stageX + COLUMN_GAP * 2 - targetX;
      for (const nodeId of downstreamOf(stageId, baseEdges)) {
        const node = byId.get(nodeId);
        if (node) setPosition(node, shape, { x: positionOf(node, shape).x + push, y: positionOf(node, shape).y });
      }
    }
    const wantedX = stageX + COLUMN_GAP;
    slots.forEach((slot, index) => {
      const current = positionOf(slot, shape);
      const inGap = current.x > stageX + 8 && current.x < targetX - 8;
      if (inGap) return;
      setPosition(slot, shape, { x: wantedX, y: positionOf(stage, shape).y + index * ROW_GAP });
    });
  }
  for (const [stageId, slots] of owned) {
    if (wanted.has(stageId)) continue;
    if (nodes.some((node) => node.id === stageId)) continue;
    for (const slot of slots) removed.push(slot.id);
  }
  for (const [stageId, slots] of wanted) {
    const output = filled.get(stageId);
    if (!output || !materialize) continue;
    const specs = resultSpecs(typeById(stageId), normalizeNodeConfig(typeById(stageId), configOf(byId.get(stageId), shape), provider));
    for (const slot of slots) {
      const generated = generatedOf(slot, shape);
      if (generated.preview || generated.modelUrl || generated.outputs) continue;
      const spec = specs.find((candidate) => sameSpec(slot, shape, candidate));
      const media = spec && materialize(spec, output);
      if (!media) continue;
      setGenerated(slot, shape, { ...generated, ...media, resultOf: { ...generated.resultOf || {}, sourceId: stageId }, slot: spec.slot, ...spec.view ? { view: spec.view } : {} });
      materialized.push(slot.id);
    }
  }
  const nextEdges = [];
  const connected = /* @__PURE__ */ new Set();
  const linked = edges.filter((edge) => byId.has(edge.source?.nodeId || "") && byId.has(edge.target?.nodeId || ""));
  const stageEdges = linked.filter((edge) => !isResultType(typeById(edge.source.nodeId)) && !isResultType(typeById(edge.target.nodeId)));
  const slotEdges = linked.filter((edge) => isResultType(typeById(edge.source.nodeId)));
  const dropped = new Set(removed);
  for (const [stageId, slots] of wanted) {
    const stageType = typeById(stageId);
    for (const slot of slots) {
      const slotType = typeOf(slot, shape) || "";
      const view = generatedOf(slot, shape).view;
      const ports = nodeOutputPorts(stageType);
      const source = view && ports.find((port) => port.id === view) || ports.find((port) => {
        const forward = outputPortOf(slotType);
        return forward && (port.type === forward.type || port.type === "any" || forward.type === "any");
      });
      const target = outputPortOf(slotType);
      if (!source || !target) continue;
      const id = `edge-${stageId}-${slot.id}`;
      if (nextEdges.some((edge) => edge.id === id) || connected.has(id)) continue;
      connected.add(id);
      nextEdges.push(slotLink(stageId, slot.id, source.id, target.id, shape, id));
    }
  }
  for (const edge of stageEdges) {
    const sourceId = edge.source.nodeId;
    const targetId = edge.target.nodeId;
    const slots = wanted.get(sourceId);
    if (!slots?.length) {
      nextEdges.push(edge);
      continue;
    }
    const targetType = typeById(targetId);
    if (!targetType) continue;
    const pair = mediaPair(typeById(sourceId), targetType);
    if (!pair) continue;
    const targetPort = nodeInputPorts(targetType).find((port) => port.id === edge.target.port);
    const collects = Boolean(targetPort?.multiple);
    const viewSlots = slots.filter((slot) => generatedOf(slot, shape).view);
    const usable = collects ? slots : viewSlots.length ? viewSlots : slots.slice(0, 1);
    for (const slot of usable) {
      const slotType = typeOf(slot, shape) || "";
      const output = outputPortOf(slotType);
      if (!output) continue;
      const view = generatedOf(slot, shape).view;
      const inputs = activeInputPorts(targetType, configOf(byId.get(targetId), shape));
      const viewPort = view && inputs.find((port) => port.id === view && (port.type === output.type || port.type === "any"));
      const openInput = viewPort || inputs.find((port) => port.id === output.id && (port.type === output.type || port.type === "any")) || inputs.find((port) => port.type === output.type || port.type === "any");
      const target = viewPort || (targetPort && (targetPort.type === output.type || targetPort.type === "any") ? targetPort : null) || openInput;
      if (!target) continue;
      const id = `edge-${slot.id}-${targetId}-${target.id}`;
      if (connected.has(id)) continue;
      connected.add(id);
      nextEdges.push(slotLink(slot.id, targetId, output.id, target.id, shape, id));
    }
  }
  for (const [stageId, slots] of wanted) {
    const stageType = typeById(stageId);
    if (!stageType || !slots.length) continue;
    const downstream = nodes.filter((node) => {
      const type = typeOf(node, shape) || "";
      return !isResultType(type) && node.id !== stageId && mediaPair(stageType, type);
    });
    for (const node of downstream) {
      const type = typeOf(node, shape) || "";
      if (linked.some((edge) => edge.target?.nodeId === node.id)) continue;
      const config = configOf(node, shape);
      const inputs = activeInputPorts(type, config);
      for (const slot of slots) {
        const slotType = typeOf(slot, shape) || "";
        const output = outputPortOf(slotType);
        if (!output) continue;
        const view = generatedOf(slot, shape).view;
        const target = view && inputs.find((port) => port.id === view && (port.type === output.type || port.type === "any")) || inputs.find((port) => port.id === output.id && (port.type === output.type || port.type === "any")) || inputs.find((port) => port.type === output.type || port.type === "any");
        if (!target) continue;
        const id = `edge-${slot.id}-${node.id}-${target.id}`;
        if (connected.has(id)) continue;
        connected.add(id);
        nextEdges.push(slotLink(slot.id, node.id, output.id, target.id, shape, id));
      }
    }
  }
  for (const edge of slotEdges) {
    if (dropped.has(edge.source.nodeId) || dropped.has(edge.target.nodeId)) continue;
    const slot = byId.get(edge.target.nodeId);
    const slotStage = slot && stageOf(slot, shape);
    if (slotStage && nodeRole(typeById(slotStage)) === "execution") continue;
    nextEdges.push(edge);
  }
  canvas.nodes = [...nodes.filter((node) => !dropped.has(node.id)), ...added];
  const untouched = edges.filter((edge) => !byId.has(edge.source?.nodeId || "") || !byId.has(edge.target?.nodeId || ""));
  canvas.edges = shape === "canvas" ? nextEdges.map((edge) => ({ ...edge, source: edge.source.nodeId, target: edge.target.nodeId, sourceHandle: "output", targetHandle: "input" })) : nextEdges;
  if (untouched.length) canvas.edges = [...canvas.edges, ...untouched];
  return { canvas, added, removed, materialized };
}
function slotLink(sourceId, targetId, sourcePort, targetPort, shape, id = `edge-${sourceId}-${targetId}`) {
  if (shape === "canvas") {
    return { id, source: { nodeId: sourceId, port: sourcePort }, target: { nodeId: targetId, port: targetPort }, sourceHandle: "output", targetHandle: "input", data: { logicalConnections: [{ sourcePort, targetPort }] }, selectable: true, type: "execution" };
  }
  return { id, source: { nodeId: sourceId, port: sourcePort }, target: { nodeId: targetId, port: targetPort } };
}
function createSlot(canvas, shape, stage, stageType, spec, taken, output, materialize, shiftX = 0) {
  const base = `${spec.type}-${stage.id}-${spec.slot.replace(/[^a-z0-9]+/gi, "-")}`;
  let id = base;
  let index = 2;
  while (taken.has(id)) id = `${base}-${index++}`;
  taken.add(id);
  const siblings = canvas.nodes.filter((node) => stageOf(node, shape) === stage.id);
  const origin = { ...positionOf(stage, shape), x: positionOf(stage, shape).x + shiftX };
  const media = spec && output && materialize ? materialize(spec, output) : null;
  const generated = {
    resultOf: { sourceId: stage.id },
    slot: spec.slot,
    ...spec.view ? { view: spec.view } : {},
    ...media || {}
  };
  const siblingX = siblings.map((node) => positionOf(node, shape).x).filter((x) => x > origin.x + 1);
  const columnX = COLUMN_GAP;
  const position = { x: origin.x + columnX, y: origin.y + siblings.length * ROW_GAP };
  if (shape === "canvas") {
    return {
      id,
      type: "canvas",
      position,
      parentNode: parentOf(stage, shape),
      data: {
        kind: "OUTPUT",
        label: spec.name,
        detail: spec.type === "generated-model" ? "Generated model" : spec.type === "generated-export" ? "Exported file" : "Generated image",
        tone: spec.type === "generated-model" ? "green" : "amber",
        status: "ready",
        canvasType: spec.type,
        provider: canvas.provider || "tripo",
        config: {},
        uploadAssets: {},
        generatedAssets: generated,
        inputPorts: [{ ...inputPortOf(spec.type) || { id: "input", type: "image", label: "Input" }, id: "input" }],
        outputPorts: nodeOutputPorts(spec.type)
      }
    };
  }
  return {
    id,
    type: spec.type,
    name: spec.name,
    config: {},
    generatedAssets: generated,
    ui: { position, ...parentOf(stage, shape) ? { parentFrameId: parentOf(stage, shape) } : {} }
  };
}

// packages/canvas-core/src/wire-tie.ts
var PIN_TURNS = [15, -15, 30, -30, 45, -45, 60, -60].map((degrees) => degrees * Math.PI / 180);

// packages/canvas-core/src/starter-canvas.ts
var COL = [48, 360, 672];
var TOP = 56;
var FRAME_W = 980;
var SINGLE_H = 720;
var MULTI_H = 1180;
var ROW = 270;
function imageAsset(path6) {
  return { assetType: "image", assetUrl: path6, reference: path6.slice(1) };
}
function step(id, type, x, y, frameId, config = {}, name = "", uploadAssets = null) {
  return {
    id,
    type,
    name: name || nodeSchema(type, "meshy")?.label || type,
    config: { ...nodeDefaults(type, "meshy"), ...config },
    ...uploadAssets ? { uploadAssets } : {},
    ui: { position: { x, y }, parentFrameId: frameId }
  };
}
function frame(id, name, description, x, y, width, height) {
  return {
    id,
    type: "frame",
    name,
    config: { description },
    ui: { position: { x, y }, size: { width, height } }
  };
}
function link(id, sourceId, sourcePort, targetId, targetPort) {
  return {
    id,
    source: { nodeId: sourceId, port: sourcePort },
    target: { nodeId: targetId, port: targetPort }
  };
}
function starterCanvasGraph() {
  const nodes = [
    frame("starter-image", "Image to 3D", "One reference image becomes a textured model.", 0, 0, FRAME_W, SINGLE_H),
    step("starter-image-upload", "reference-image", COL[0], TOP, "starter-image", {}, "Reference image", imageAsset("/shark-reference.png")),
    step("starter-image-model", "generate-model", COL[1], TOP, "starter-image"),
    step("starter-image-export", "export-model", COL[2], TOP, "starter-image", { fileName: "image-to-3d" }),
    frame("starter-text", "Text to 3D", "A text prompt becomes a textured model.", FRAME_W + 48, 0, FRAME_W, SINGLE_H),
    step("starter-text-prompt", "prompt", COL[0], TOP, "starter-text"),
    step("starter-text-model", "text-to-3d", COL[1], TOP, "starter-text"),
    step("starter-text-export", "export-model", COL[2], TOP, "starter-text", { fileName: "text-to-3d" }),
    frame("starter-multiview", "Multi-view to 3D", "Front, back, left, and right views of the same object become a model.", 0, SINGLE_H + 48, FRAME_W, MULTI_H),
    step("starter-mv-front", "reference-image", COL[0], TOP, "starter-multiview", {}, "Front", imageAsset("/shark-concept-front.png")),
    step("starter-mv-back", "reference-image", COL[0], TOP + ROW, "starter-multiview", {}, "Back", imageAsset("/shark-concept-back.png")),
    step("starter-mv-left", "reference-image", COL[0], TOP + ROW * 2, "starter-multiview", {}, "Left", imageAsset("/shark-concept-left.png")),
    step("starter-mv-right", "reference-image", COL[0], TOP + ROW * 3, "starter-multiview", {}, "Right", imageAsset("/shark-concept-right.png")),
    step("starter-mv-model", "multiview-to-3d", COL[1], TOP + ROW, "starter-multiview"),
    step("starter-mv-export", "export-model", COL[2], TOP + ROW, "starter-multiview", { fileName: "multiview" })
  ];
  const edges = [
    link("starter-edge-image", "starter-image-upload", "image", "starter-image-model", "image"),
    link("starter-edge-image-export", "starter-image-model", "model", "starter-image-export", "model"),
    link("starter-edge-text", "starter-text-prompt", "text", "starter-text-model", "text"),
    link("starter-edge-text-export", "starter-text-model", "model", "starter-text-export", "model"),
    link("starter-edge-mv-front", "starter-mv-front", "image", "starter-mv-model", "front"),
    link("starter-edge-mv-back", "starter-mv-back", "image", "starter-mv-model", "back"),
    link("starter-edge-mv-left", "starter-mv-left", "image", "starter-mv-model", "left"),
    link("starter-edge-mv-right", "starter-mv-right", "image", "starter-mv-model", "right"),
    link("starter-edge-mv-export", "starter-mv-model", "model", "starter-mv-export", "model")
  ];
  return { nodes, edges };
}
var starterCanvasViewport = { x: 48, y: 36, zoom: 0.6 };

// server/migrations.ts
function migrateCanvasRefs(records) {
  return records.map((record) => {
    if (record.workflowId === void 0 && record.workflowRevision === void 0) return record;
    const migrated = structuredClone(record);
    if (migrated.canvasId === void 0 && migrated.workflowId !== void 0) migrated.canvasId = migrated.workflowId;
    if (migrated.canvasRevision === void 0 && migrated.workflowRevision !== void 0) migrated.canvasRevision = migrated.workflowRevision;
    delete migrated.workflowId;
    delete migrated.workflowRevision;
    return migrated;
  });
}
function migrateTurns(turns) {
  return turns.map((turn) => {
    if (!turn.conversationId && !turn.threadId && !turn.result?.conversation && !turn.result?.thread && (turn.sessionId || !turn.result?.session?.id)) return turn;
    const migrated = structuredClone(turn);
    if (!migrated.sessionId) migrated.sessionId = migrated.threadId || migrated.conversationId;
    delete migrated.threadId;
    delete migrated.conversationId;
    if (migrated.result) {
      if (!migrated.result.session) migrated.result.session = migrated.result.thread || migrated.result.conversation;
      delete migrated.result.thread;
      delete migrated.result.conversation;
    }
    if (!migrated.sessionId && migrated.result?.session?.id) migrated.sessionId = migrated.result.session.id;
    return migrated;
  });
}

// server/store.ts
var root = path.dirname(fileURLToPath(import.meta.url));
var seedDirectory = path.join(root, "seed");
var defaultDataDirectory = path.join(root, "data");
var retiredNodeTypes = /* @__PURE__ */ new Set(["save-asset", "bake"]);
function migrateCanvas(canvas, now = () => (/* @__PURE__ */ new Date()).toISOString()) {
  const migrated = structuredClone(canvas);
  const retainedNodes = migrated.nodes.filter((node) => !retiredNodeTypes.has(node.type));
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id));
  let changed = retainedNodes.length !== migrated.nodes.length;
  if (migrated.provider === void 0) {
    migrated.provider = "tripo";
    changed = true;
  }
  migrated.nodes = retainedNodes.map((node) => {
    if (node.type === "frame") return node;
    const type = node.type === "split" ? "segments" : node.type;
    const split = splitNodeTrees(node.config, node.uploadAssets, node.generatedAssets, node.outputResult);
    const config = normalizeNodeConfig(type, split.config, migrated.provider);
    const uploadAssets = split.uploadAssets;
    const generatedAssets = normalizeGeneratedAssets(type, split.generatedAssets);
    const trees = { ...Object.keys(uploadAssets).length ? { uploadAssets } : {}, ...Object.keys(generatedAssets).length ? { generatedAssets } : {} };
    if (node.type === "split") {
      changed = true;
      return { ...node, type: "segments", name: node.name === "Split" ? "Segments" : node.name, config, ...trees };
    }
    if (!("outputResult" in node) && JSON.stringify(config) === JSON.stringify(node.config) && JSON.stringify(uploadAssets) === JSON.stringify(node.uploadAssets || {}) && JSON.stringify(generatedAssets) === JSON.stringify(node.generatedAssets || {})) return node;
    changed = true;
    const { uploadAssets: staleUploads, generatedAssets: staleResults, outputResult: staleName, ...rest } = node;
    return { ...rest, config, ...trees };
  });
  const retainedEdges = migrated.edges.filter((edge) => retainedNodeIds.has(edge.source.nodeId) && retainedNodeIds.has(edge.target.nodeId));
  if (retainedEdges.length !== migrated.edges.length) changed = true;
  migrated.edges = retainedEdges;
  const description = migrated.description?.replace(/, review, save, and export/, ", and review").replace(/, review (a production-ready)/, ", and review $1");
  if (description !== migrated.description) {
    migrated.description = description;
    changed = true;
  }
  if (!changed) return canvas;
  migrated.revision = (migrated.revision || 0) + 1;
  migrated.updatedAt = now();
  return migrated;
}

// server/tables.ts
var LEGACY_OWNER_ID = "demo-user";
var tableColumns = {
  canvases: {
    table: "canvases",
    orderBy: "updated_at, id",
    columns: [
      ["id", "id", "text"],
      ["owner_id", "ownerId", "text"],
      ["name", "name", "text"],
      ["description", "description", "text"],
      ["provider", "provider", "text"],
      ["schema_version", "schemaVersion", "text"],
      ["revision", "revision", "int"],
      ["nodes", "nodes", "json"],
      ["edges", "edges", "json"],
      ["wire_ties", "wireTies", "json"],
      ["viewport", "viewport", "json"],
      ["created_at", "createdAt", "time"],
      ["updated_at", "updatedAt", "time"]
    ]
  },
  sessions: {
    table: "sessions",
    orderBy: "updated_at, id",
    columns: [
      ["id", "id", "text"],
      ["canvas_id", "canvasId", "text"],
      ["messages", "messages", "json"],
      ["created_at", "createdAt", "time"],
      ["updated_at", "updatedAt", "time"]
    ]
  },
  runs: {
    table: "runs",
    orderBy: "created_at, id",
    columns: [
      ["id", "id", "text"],
      ["canvas_id", "canvasId", "text"],
      ["status", "status", "text"],
      ["mode", "mode", "text"],
      ["entry_node_id", "entryNodeId", "text"],
      ["entry_node_type", "entryNodeType", "text"],
      ["entry_node_name", "entryNodeName", "text"],
      ["canvas_revision", "canvasRevision", "int"],
      ["idempotency_key", "idempotencyKey", "text"],
      ["cancel_requested", "cancelRequested", "bool"],
      ["node_ids", "nodeIds", "json"],
      ["parameters", "parameters", "json"],
      ["input", "input", "json"],
      ["node_runs", "nodeRuns", "json"],
      ["created_at", "createdAt", "time"],
      ["completed_at", "completedAt", "time"]
    ]
  },
  turns: {
    table: "turns",
    orderBy: "updated_at, id",
    columns: [
      ["id", "id", "text"],
      ["canvas_id", "canvasId", "text"],
      ["session_id", "sessionId", "text"],
      ["status", "status", "text"],
      ["message", "message", "text"],
      ["client_id", "clientId", "text"],
      ["trace_id", "traceId", "text"],
      ["attempt", "attempt", "int"],
      ["attachments", "attachments", "json"],
      ["progress", "progress", "json"],
      ["request", "request", "json"],
      ["selection", "selection", "json"],
      ["result", "result", "json"],
      ["error", "error", "text"],
      ["created_at", "createdAt", "time"],
      ["started_at", "startedAt", "time"],
      ["updated_at", "updatedAt", "time"],
      ["completed_at", "completedAt", "time"],
      ["interrupted_at", "interruptedAt", "time"],
      ["resume_count", "resumeCount", "int"],
      ["request_message_id", "requestMessageId", "text"]
    ]
  },
  agentTraces: {
    table: "agent_traces",
    orderBy: "updated_at, id",
    columns: [
      ["id", "id", "text"],
      ["turn_id", "turnId", "text"],
      ["canvas_id", "canvasId", "text"],
      ["session_id", "sessionId", "text"],
      ["status", "status", "text"],
      ["provider", "provider", "text"],
      ["model", "model", "text"],
      ["runtime", "runtime", "text"],
      ["attempt", "attempt", "int"],
      ["resume_count", "resumeCount", "int"],
      ["events", "events", "json"],
      ["checkpoint", "checkpoint", "json"],
      ["created_at", "createdAt", "time"],
      ["updated_at", "updatedAt", "time"],
      ["completed_at", "completedAt", "time"]
    ]
  },
  accounts: {
    table: "accounts",
    orderBy: "id",
    columns: [
      ["id", "id", "text"],
      ["name", "name", "text"],
      ["balance", "balance", "int"]
    ]
  },
  creditLedger: {
    table: "credit_ledger",
    orderBy: "created_at, id",
    columns: [
      ["id", "id", "text"],
      ["account_id", "accountId", "text"],
      ["run_id", "runId", "text"],
      ["type", "type", "text"],
      ["amount", "amount", "int"],
      ["created_at", "createdAt", "time"]
    ]
  }
};
var keepNull = /* @__PURE__ */ new Set(["runs.completedAt"]);
function rowToRecord(collection, row, parseJson2) {
  const record = {};
  for (const [column, field, kind] of tableColumns[collection].columns) {
    let value = row[column];
    if (value === null || value === void 0) {
      if (keepNull.has(`${collection}.${field}`)) record[field] = null;
      continue;
    }
    if (kind === "json" && parseJson2 && typeof value === "string") value = JSON.parse(value);
    else if (kind === "bool") value = Boolean(value);
    else if (kind === "time" && value instanceof Date) value = value.toISOString();
    record[field] = value;
  }
  if (collection === "runs") record.projectId = record.canvasId;
  if (collection === "canvases" && !record.ownerId) record.ownerId = LEGACY_OWNER_ID;
  if (collection === "canvases" && Array.isArray(record.wireTies) && !record.wireTies.length) delete record.wireTies;
  return record;
}
var notNullDefaults = {
  "canvases.description": "",
  "canvases.schemaVersion": "1.0",
  "canvases.revision": 1,
  "canvases.nodes": [],
  "canvases.edges": [],
  "canvases.wireTies": [],
  "canvases.viewport": { x: 0, y: 0, zoom: 1 },
  "sessions.messages": [],
  "agentTraces.events": []
};
function recordToValues(collection, record, { boolAsInt = false } = {}) {
  return tableColumns[collection].columns.map(([, field, kind]) => {
    let value = record[field];
    if (collection === "canvases" && field === "ownerId") value ||= LEGACY_OWNER_ID;
    if ((value === void 0 || value === null) && notNullDefaults[`${collection}.${field}`] !== void 0) value = notNullDefaults[`${collection}.${field}`];
    if (kind === "bool") return boolAsInt ? value ? 1 : 0 : Boolean(value);
    if (value === void 0 || value === null) return null;
    return kind === "json" ? JSON.stringify(value) : value;
  });
}

// server/tripo-assets.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var root2 = path2.dirname(fileURLToPath2(import.meta.url));
var assetDirectory = path2.join(process.env.FORGE3D_DATA_DIR || path2.join(root2, "data"), "assets");
var assetUrlPrefix = "/api/assets/";
var EXTENSION_BY_CONTENT_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "model/gltf-binary": "glb",
  "application/octet-stream": "glb"
};
var ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set(["png", "jpg", "webp", "glb", "gltf", "fbx", "usdz", "obj", "stl", "3mf"]);
var CONTENT_TYPE_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  fbx: "application/octet-stream",
  usdz: "model/vnd.usdz+zip",
  obj: "text/plain; charset=utf-8",
  stl: "application/octet-stream",
  "3mf": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
};
var ASSET_FILE_PATTERN = /^[a-f0-9]{32}\.[a-z0-9]{2,4}$/;
function isAssetFileName(file) {
  return ASSET_FILE_PATTERN.test(file);
}
function assetExtension(url, contentType = "") {
  const fromUrl = new URL(url, "https://placeholder.invalid").pathname.split(".").pop()?.toLowerCase();
  if (fromUrl && ALLOWED_EXTENSIONS.has(fromUrl)) return fromUrl;
  return EXTENSION_BY_CONTENT_TYPE[contentType.split(";")[0].trim().toLowerCase()] || "bin";
}
function assetContentType(file) {
  return CONTENT_TYPE_BY_EXTENSION[file.split(".").pop().toLowerCase()] || "application/octet-stream";
}
function resolveAssetPath(file) {
  if (!isAssetFileName(file)) return null;
  const resolved = path2.join(assetDirectory, file);
  return resolved.startsWith(assetDirectory + path2.sep) ? resolved : null;
}
async function persistUploadedAsset(bytes, contentType = "", filename = "", {
  directory = assetDirectory
} = {}) {
  const extension = assetExtension(filename, contentType);
  const file = `${createHash("md5").update(bytes).digest("hex")}.${extension}`;
  const destination = path2.join(directory, file);
  await mkdir(directory, { recursive: true });
  try {
    await stat(destination);
  } catch {
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  }
  return `${assetUrlPrefix}${file}`;
}
async function readAsset(file) {
  const resolved = resolveAssetPath(file);
  if (!resolved) return null;
  try {
    return { bytes: await readFile(resolved), contentType: assetContentType(file) };
  } catch {
    return null;
  }
}

// server/sqlite-store.ts
var collections = ["canvases", "sessions", "runs", "turns", "agentTraces", "accounts", "creditLedger"];
var root3 = process.env.FORGE3D_SERVER_DIR || path3.dirname(fileURLToPath3(import.meta.url));
var seedDirectory2 = path3.join(root3, "seed");
var migrationDirectory = path3.join(root3, "..", "migrations");
var dataDirectory = process.env.FORGE3D_DATA_DIR || path3.join(root3, "data");
var defaultFile = path3.join(dataDirectory, "forge3d.sqlite");
var LEGACY_OWNER_ID2 = "demo-user";
var ASSET_TABLE = `
CREATE TABLE IF NOT EXISTS forge3d_assets (
  asset_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;
function selectAll(collection) {
  const { table, orderBy } = tableColumns[collection];
  return `SELECT * FROM ${table} ORDER BY ${orderBy}`;
}
function insertStatement(collection) {
  const { table, columns } = tableColumns[collection];
  const placeholders = columns.map((_, index) => `?${index + 1}`).join(", ");
  return `INSERT INTO ${table} (${columns.map(([column]) => column).join(", ")}) VALUES (${placeholders})`;
}
async function createSqliteStore({ file = process.env.SQLITE_PATH || defaultFile } = {}) {
  await mkdir2(path3.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 5e3 });
  db.exec("PRAGMA journal_mode = WAL");
  await applyMigrations(db);
  db.exec(ASSET_TABLE);
  await importAssets(db);
  const state = Object.fromEntries(await Promise.all(collections.map(async (collection) => [collection, await loadOrSeed(db, collection)])));
  state.canvases = state.canvases.map((canvas) => migrateCanvas(canvas));
  state.sessions = migrateCanvasRefs(state.sessions);
  state.runs = migrateCanvasRefs(state.runs);
  state.turns = migrateTurns(state.turns);
  const persistQueues = /* @__PURE__ */ new Map();
  async function loadOrSeed(database, collection) {
    const rows = database.prepare(selectAll(collection)).all();
    if (rows.length) return rows.map((row) => rowToRecord(collection, row, true));
    const contents = await readFile2(path3.join(seedDirectory2, `${collection}.json`), "utf8");
    let seeded = JSON.parse(contents).map((document) => collection === "canvases" ? { ...document, ownerId: document.ownerId || LEGACY_OWNER_ID2 } : document);
    if (collection === "canvases") seeded = seeded.map((canvas) => migrateCanvas(canvas));
    if (collection === "sessions" || collection === "runs") seeded = migrateCanvasRefs(seeded);
    if (collection === "turns") seeded = migrateTurns(seeded);
    persistCollection(database, collection, seeded);
    return seeded;
  }
  function persistCollection(database, collection, documents) {
    const insert = database.prepare(insertStatement(collection));
    database.exec("BEGIN");
    try {
      database.prepare(`DELETE FROM ${tableColumns[collection].table}`).run();
      for (const document of documents) insert.run(...recordToValues(collection, document, { boolAsInt: true }));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  async function persist(collection) {
    const queued = (persistQueues.get(collection) || Promise.resolve()).catch(() => {
    }).then(() => persistCollection(db, collection, state[collection]));
    persistQueues.set(collection, queued);
    await queued;
  }
  async function reload(collection) {
    state[collection] = db.prepare(selectAll(collection)).all().map((row) => rowToRecord(collection, row, true));
    return state[collection];
  }
  async function removeCanvas(canvasId) {
    db.prepare("DELETE FROM canvases WHERE id = ?1").run(canvasId);
  }
  async function uploadAsset2(bytes, contentType = "", filename = "") {
    const extension = assetExtension(filename, contentType);
    const assetId = `${createHash2("md5").update(bytes).digest("hex")}.${extension}`;
    db.prepare(
      "INSERT INTO forge3d_assets (asset_id, content_type, bytes) VALUES (?1, ?2, ?3) ON CONFLICT (asset_id) DO NOTHING"
    ).run(assetId, contentType.split(";")[0].trim() || assetContentType(assetId), bytes);
    return `${assetUrlPrefix}${assetId}`;
  }
  async function readAsset3(assetId) {
    if (!isAssetFileName(assetId)) return null;
    const row = db.prepare("SELECT content_type, bytes FROM forge3d_assets WHERE asset_id = ?1").get(assetId);
    if (!row) return null;
    return { bytes: row.bytes, contentType: row.content_type };
  }
  return { state, persist, reload, removeCanvas, uploadAsset: uploadAsset2, readAsset: readAsset3, close: () => db.close() };
}
async function applyMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forge3d_schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  const applied = new Set(db.prepare("SELECT name FROM forge3d_schema_migrations").all().map((row) => row.name));
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const record = db.prepare("INSERT INTO forge3d_schema_migrations (name) VALUES (?1)");
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile2(path3.join(migrationDirectory, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      record.run(file);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`SQLite migration ${file} failed: ${error.message}`);
    }
  }
}
async function importAssets(db) {
  const files = (await readdir(assetDirectory).catch(() => [])).filter(isAssetFileName);
  const insert = db.prepare(
    "INSERT INTO forge3d_assets (asset_id, content_type, bytes) VALUES (?1, ?2, ?3) ON CONFLICT (asset_id) DO NOTHING"
  );
  for (const assetId of files) {
    insert.run(assetId, assetContentType(assetId), await readFile2(path3.join(assetDirectory, assetId)));
  }
}

// server/tripo.ts
var DEFAULT_BASE_URL = "https://openapi.tripo3d.ai/v3";
var RETRY_BASE_MS = 1e3;
var RETRY_CAP_MS = 32e3;
var MAX_RETRIES = 5;
var TERMINAL_FAILURES = /* @__PURE__ */ new Set(["failed", "banned", "expired", "cancelled"]);
var TripoError = class extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
};
function isTripoConfigured(env = process.env) {
  return Boolean(env.TRIPO_API_KEY);
}
function retryDelay(response, attempt) {
  const header = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1e3, RETRY_CAP_MS);
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS);
}
function createTripoClient({
  apiKey = process.env.TRIPO_API_KEY,
  baseUrl = process.env.TRIPO_BASE_URL,
  fetchImpl = fetch,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
} = {}) {
  if (!apiKey) throw new TripoError("Tripo is not configured. Set TRIPO_API_KEY.", 503);
  const root6 = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  async function send(path6, { method = "GET", body = null, headers = {} } = {}) {
    let lastResponse = null;
    let lastFailure = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(`${root6}${path6}`, {
          method,
          headers: { authorization: `Bearer ${apiKey}`, ...headers },
          ...body ? { body } : {},
          signal: AbortSignal.timeout(6e4)
        });
      } catch (failure) {
        if (attempt === MAX_RETRIES) throw new TripoError("The Tripo service is unavailable.", 503);
        lastFailure = failure;
        await wait(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS));
        continue;
      }
      if (response.status !== 429 && response.status < 500) return unwrap(response, path6);
      lastResponse = response;
      if (attempt === MAX_RETRIES) break;
      await wait(retryDelay(response, attempt));
    }
    if (!lastResponse) throw new TripoError("The Tripo service is unavailable.", 503);
    throw new TripoError(`Tripo request to ${path6} failed with status ${lastResponse.status}.`, lastResponse.status === 429 ? 503 : 502);
  }
  async function unwrap(response, path6) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new TripoError(`Tripo returned an invalid response for ${path6}.`);
    }
    if (!response.ok) {
      const detail = payload?.message || payload?.error || `status ${response.status}`;
      throw new TripoError(`Tripo request to ${path6} failed: ${detail}.`, response.status === 401 || response.status === 403 ? 503 : 502);
    }
    if (payload?.code !== 0) throw new TripoError(`Tripo rejected ${path6}: ${payload?.message || `code ${payload?.code}`}.`);
    return payload.data;
  }
  return {
    /** Uploads bytes and returns a `file_token` usable as any endpoint's `input`. */
    async uploadFile(bytes, filename = "upload", contentType = "application/octet-stream") {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: contentType }), filename);
      const data = await send("/files", { method: "POST", body: form });
      if (!data?.file_token) throw new TripoError("Tripo did not return a file token.");
      return data.file_token;
    },
    /** Creates a task and returns its id. */
    async createTask(endpoint, body) {
      const data = await send(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!data?.task_id) throw new TripoError(`Tripo did not return a task id for ${endpoint}.`);
      return data.task_id;
    },
    async getTask(taskId) {
      return send(`/tasks/${encodeURIComponent(taskId)}`);
    },
    async balance() {
      return send("/account/balance");
    },
    /**
     * Polls until Tripo itself reports a terminal state. Tripo recommends 1-2s
     * intervals.
     *
     * A status request that fails tells us nothing about the task, so it is
     * retried rather than treated as a failed generation: the submitted task is
     * still running on Tripo's side and only Tripo can say it failed. This polls
     * for as long as it takes; a lost status endpoint never turns into a
     * generation failure.
     */
    async awaitTask(taskId, { intervalMs = 2e3, onProgress = () => {
    } } = {}) {
      for (; ; ) {
        let task;
        try {
          task = await this.getTask(taskId);
        } catch (failure) {
          console.warn(`[tripo] status lookup for task ${taskId} failed, still polling: ${failure.message}`);
          await wait(intervalMs);
          continue;
        }
        await onProgress(task);
        if (task.status === "success") return task;
        if (TERMINAL_FAILURES.has(task.status)) {
          const reason = task.status === "banned" ? ": the input violates the content policy" : task.message || task.error ? `: ${task.message || task.error}` : "";
          throw new TripoError(`Tripo task ${task.status}${reason} (task ${taskId}).`, 422);
        }
        await wait(intervalMs);
      }
    }
  };
}

// server/tripo-provider.ts
import { readFile as readFile3 } from "node:fs/promises";
import path4 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";

// server/tripo-mapping.ts
var tripoNodeTypes = /* @__PURE__ */ new Set(["generate-model", "retopology", "texture", "segments", "rigging", "export-model"]);
var TRIPO_NODE_TYPES = tripoNodeTypes;
function supportsV3Options(modelVersion) {
  return modelVersion !== "v2.5-20250123";
}
var SEGMENTATION_GRANULARITY = { low: "simple", medium: "balanced", high: "detailed" };
var CONVERT_FORMATS = { gltf: "GLTF", fbx: "FBX", usdz: "USDZ", obj: "OBJ", stl: "STL", "3mf": "3MF" };
function generateModelRequest(config, { input, prompt, multiview }) {
  const modelVersion = config.modelVersion;
  const body = { model: modelVersion };
  if (config.generateParts && supportsV3Options(modelVersion)) {
    body.generate_parts = true;
    body.texture = false;
    body.pbr = false;
  } else {
    body.texture = config.texture !== false;
    body.pbr = body.texture ? config.pbr !== false : false;
    if (body.texture && supportsV3Options(modelVersion)) body.texture_quality = config.textureQuality || "standard";
    if (supportsV3Options(modelVersion)) body.quad = config.topology === "quad";
  }
  if (supportsV3Options(modelVersion)) body.geometry_quality = config.geometryQuality ? "detailed" : "standard";
  if (Number(config.faceCount) > 0) body.face_limit = Number(config.faceCount);
  if (multiview) return { endpoint: "/generation/multiview-to-model", body: { ...body, inputs: multiview } };
  if (input) return { endpoint: "/generation/image-to-model", body: { ...body, input } };
  if (prompt) return { endpoint: "/generation/text-to-model", body: { ...body, prompt } };
  throw new Error("Gen HD Model needs an upstream image or a text prompt.");
}
function texturePrompt(config, { input, prompt, imageInput }) {
  if (config.inputMode === "textGenerate" && prompt) return { text: prompt };
  if (config.inputMode === "imageGenerate" && imageInput) return { image: imageInput };
  return null;
}
function tripoRequest(node, { input = null, prompt = "", imageInput = null, multiview = null } = {}) {
  if (!TRIPO_NODE_TYPES.has(node.type)) return null;
  const config = node.config || {};
  if (node.type === "generate-model") return generateModelRequest(config, { input, prompt, multiview });
  if (!input) throw new Error(`${node.name || node.type} needs an upstream 3D model.`);
  if (node.type === "retopology") {
    const model = config.smartPoly ? "v2.0" : "v1.0";
    const body2 = { input, model, quad: config.topology === "quad" };
    if (Number(config.faceLimit) > 0) body2.face_limit = Number(config.faceLimit);
    else if (model === "v1.0") throw new Error("Retopology needs a polygon count when Smart Low Poly is off.");
    return { endpoint: "/mesh/decimate", body: body2 };
  }
  if (node.type === "texture") {
    const body2 = { input, model: "v3.0-20250812", pbr: true, texture_quality: config.textureQuality || "standard" };
    const guidance = texturePrompt(config, { input, prompt, imageInput });
    if (guidance) body2.texture_prompt = guidance;
    return { endpoint: "/models/texture", body: body2 };
  }
  if (node.type === "segments") {
    return {
      endpoint: "/mesh/segment",
      body: { input, model: "v2.0-20260430", segmentation_granularity: SEGMENTATION_GRANULARITY[config.detailLevel] || "balanced" }
    };
  }
  if (node.type === "rigging") {
    return { endpoint: "/animations/rig", body: { input, model: config.modelVersion || "v1.0-20240301" } };
  }
  const format = CONVERT_FORMATS[String(config.modelFormat || "gltf").toLowerCase()] || "GLTF";
  const body = {
    input,
    format,
    texture_size: Number(config.textureSize) > 0 ? Number(config.textureSize) : 2048,
    pack_uv: config.packUV === true,
    with_animation: config.withAnimation === true
  };
  if (body.with_animation) body.animate_in_place = config.animateInPlace === true;
  if (format === "FBX") body.fbx_preset = config.fbxPreset || "blender";
  if (["OBJ", "GLTF"].includes(format)) body.export_vertex_colors = config.exportVertexColors === true;
  return { endpoint: "/models/convert", body };
}
function usesTripo(node) {
  return TRIPO_NODE_TYPES.has(node.type);
}
function tripoNodeOutput(node, task, { preview = null, modelUrl = null, fallbackPreview = null } = {}) {
  const output = task?.output || {};
  const resolvedPreview = preview || output.rendered_image_url || fallbackPreview || null;
  const resolvedModel = modelUrl || output.model_url || null;
  const taskId = task?.task_id || null;
  const shared = {
    preview: resolvedPreview,
    modelUrl: resolvedModel,
    tripoTaskId: taskId,
    creditsConsumed: task?.credits_consumed ?? null
  };
  if (node.type === "export-model") {
    const format = String(node.config?.modelFormat || "gltf").toLowerCase();
    const fileName = node.config?.fileName || "model";
    const extension = format === "gltf" ? "glb" : format;
    return {
      ...shared,
      message: `${node.name || "Export"} ready`,
      target: "3D Model",
      format,
      outputs: taskId ? [{ destination: "dcc", format, filename: `${fileName}.${extension}`, downloadUrl: `/api/tripo/tasks/${encodeURIComponent(taskId)}/download` }] : resolvedModel ? [{ destination: "dcc", format, filename: `${fileName}.${extension}`, downloadUrl: resolvedModel }] : []
    };
  }
  if (node.type === "texture") {
    return {
      ...shared,
      message: "UV texture generated",
      textureQuality: node.config?.textureQuality || "standard",
      outputs: taskId && resolvedModel ? [{ format: "glb", filename: "textured-model.glb", downloadUrl: `/api/tripo/tasks/${encodeURIComponent(taskId)}/download` }] : []
    };
  }
  return {
    ...shared,
    message: `${node.name || node.type} generated`,
    outputs: taskId && resolvedModel ? [{ format: "glb", filename: "model.glb", downloadUrl: `/api/tripo/tasks/${encodeURIComponent(taskId)}/download` }] : []
  };
}

// server/run-inputs.ts
function inboundSources(node, canvas) {
  const nodesById = new Map(canvas.nodes.map((item) => [item.id, item]));
  return (canvas.edges || []).filter((edge) => edge.target?.nodeId === node.id).map((edge) => nodesById.get(edge.source?.nodeId)).filter(Boolean);
}
function resolvePrompt(node, canvas) {
  const own = typeof node.config?.prompt === "string" ? node.config.prompt.trim() : "";
  if (own) return own;
  const text = resolveNodeInputs(node, canvas).text;
  return typeof text === "string" ? text.trim() : "";
}
function resolveUpstreamPreview(node, canvas, context2) {
  const seen = /* @__PURE__ */ new Set([node.id]);
  let frontier = inboundSources(node, canvas);
  while (frontier.length) {
    const next = [];
    for (const source of frontier) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      const produced = context2.get(source.id);
      if (produced?.preview) return produced.preview;
      next.push(...inboundSources(source, canvas));
    }
    frontier = next;
  }
  return null;
}
async function resolveGenerateModelImages(node, canvas, context2, { toInput, labeledViews = true }) {
  const sources = resolveInputSources(node, canvas);
  const views = {};
  for (const key of ["front", "back", "left", "right"]) {
    const source = (sources[key] || [])[0];
    if (!source) continue;
    const value = nodeOutputPortValues(source.node, context2.get(source.node.id))[source.portId];
    if (value) views[key] = value;
  }
  const viewKeys2 = Object.keys(views);
  if (viewKeys2.length >= 2 && views.front) {
    const inputs = [];
    for (const key of viewKeys2) {
      const resolved = await toInput(views[key]);
      inputs.push(labeledViews ? { [key]: resolved } : resolved);
    }
    return { multiview: inputs };
  }
  const loose = (sources.image || []).map((source) => nodeOutputPortValues(source.node, context2.get(source.node.id))[source.portId]).filter(Boolean);
  if (loose.length > 1) {
    const inputs = [];
    for (const url of loose) inputs.push(await toInput(url));
    return { multiview: inputs };
  }
  if (loose.length === 1) return { input: await toInput(loose[0]) };
  return {};
}

// server/tripo-provider.ts
var root4 = path4.dirname(fileURLToPath4(import.meta.url));
var publicDirectory = path4.join(root4, "..", "public");
var MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  fbx: "application/octet-stream",
  obj: "text/plain",
  stl: "application/octet-stream"
};
async function toTripoInput(reference, { client, uploads, readAsset: readAsset3 }) {
  if (!reference || typeof reference !== "string") return null;
  if (/^https?:\/\//.test(reference)) return reference;
  if (uploads.has(reference)) return uploads.get(reference);
  let bytes;
  let filename;
  if (reference.startsWith("data:")) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(reference);
    if (!match) throw new Error("The reference image could not be read.");
    const [, mime, base64, payload] = match;
    bytes = Buffer.from(base64 ? payload : decodeURIComponent(payload), base64 ? "base64" : "utf8");
    filename = `reference.${(mime.split("/")[1] || "png").toLowerCase()}`;
  } else if (reference.startsWith(assetUrlPrefix)) {
    const assetId = reference.slice(assetUrlPrefix.length);
    if (readAsset3) {
      const asset = await readAsset3(assetId);
      if (!asset) throw new Error("The upstream asset could not be read.");
      bytes = asset.bytes;
      filename = assetId;
    } else {
      const resolved = resolveAssetPath(assetId);
      if (!resolved) throw new Error("The upstream asset could not be read.");
      bytes = await readFile3(resolved);
      filename = path4.basename(resolved);
    }
  } else if (reference.startsWith("/")) {
    const resolved = path4.join(publicDirectory, reference);
    if (!resolved.startsWith(publicDirectory + path4.sep)) throw new Error("The reference image path is not allowed.");
    bytes = await readFile3(resolved).catch(() => {
      throw new Error(`The reference file ${reference} is missing.`);
    });
    filename = path4.basename(resolved);
  } else {
    throw new Error(`The reference "${reference}" is not a supported image source.`);
  }
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const token = await client.uploadFile(bytes, filename, MIME_BY_EXTENSION[extension] || "application/octet-stream");
  uploads.set(reference, token);
  return token;
}
var GENERATION_NODE_TYPES = /* @__PURE__ */ new Set(["generate-model", "multiview-to-3d", "text-to-3d", "smart-mesh"]);
function resolveUpstreamModel(node, canvas, context2) {
  const sources = resolveInputSources(node, canvas);
  const modelPorts = nodeInputPorts(node.type).filter((port) => port.type === "model" || port.type === "any");
  for (const port of modelPorts) {
    for (const source of sources[port.id] || []) {
      const produced = context2.get(source.node.id);
      if (!produced) continue;
      if (produced.tripoTaskId && GENERATION_NODE_TYPES.has(source.node.type)) return { taskId: produced.tripoTaskId };
      if (produced.modelUrl) return { reference: produced.modelUrl };
    }
  }
  return null;
}
function nodeImage(source, context2) {
  const produced = context2.get(source.id);
  if (produced?.preview) return produced.preview;
  const views = source.generatedAssets?.viewPreviews;
  return source.generatedAssets?.selectedPreview || source.generatedAssets?.preview || source.generatedAssets?.previews?.[0] || source.uploadAssets?.assetUrl || views?.front || Object.values(views || {}).find(Boolean) || null;
}
function resolveUpstreamImage(node, canvas, context2 = /* @__PURE__ */ new Map()) {
  const sources = resolveInputSources(node, canvas);
  for (const port of nodeInputPorts(node.type)) {
    if (port.type !== "image" && port.type !== "any") continue;
    for (const source of sources[port.id] || []) {
      const produced = context2.get(source.node.id);
      const value = nodeOutputPortValues(source.node, produced)[source.portId];
      if (value) return value;
    }
  }
  const seen = /* @__PURE__ */ new Set([node.id]);
  let frontier = inboundSources(node, canvas);
  while (frontier.length) {
    const next = [];
    for (const source of frontier) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      if (!nodeOutputPorts(source.type).every((port) => port.type === "model")) {
        const image = nodeImage(source, context2);
        if (image) return image;
      }
      next.push(...inboundSources(source, canvas));
    }
    frontier = next;
  }
  return null;
}
async function executeTripoNode(node, canvas, {
  client,
  context: context2 = /* @__PURE__ */ new Map(),
  uploads = /* @__PURE__ */ new Map(),
  readAsset: readAsset3,
  onProgress = async () => {
  },
  pollIntervalMs = 2e3
} = {}) {
  if (!usesTripo(node)) return null;
  const startedAt = Date.now();
  const needsModel = node.type !== "generate-model";
  const upstreamModel = needsModel ? resolveUpstreamModel(node, canvas, context2) : null;
  let input = null;
  let multiview = null;
  if (needsModel) {
    input = upstreamModel?.taskId || await toTripoInput(upstreamModel?.reference, { client, uploads, readAsset: readAsset3 });
  } else {
    const toInput = (reference) => toTripoInput(reference, { client, uploads, readAsset: readAsset3 });
    const resolved = await resolveGenerateModelImages(node, canvas, context2, { toInput, labeledViews: true });
    input = resolved.input ?? null;
    multiview = resolved.multiview ?? null;
  }
  const imageInput = node.type === "texture" ? await toTripoInput(resolveUpstreamImage(node, canvas, context2), { client, uploads, readAsset: readAsset3 }) : null;
  const request = tripoRequest(node, { input, prompt: resolvePrompt(node, canvas), imageInput, multiview });
  if (!request) return null;
  const taskId = await client.createTask(request.endpoint, request.body);
  await onProgress({ tripoTaskId: taskId, progress: 0 });
  const task = await client.awaitTask(taskId, {
    intervalMs: pollIntervalMs,
    onProgress: (current) => onProgress({ tripoTaskId: taskId, progress: current.progress ?? 0 })
  });
  const fallbackPreview = resolveUpstreamPreview(node, canvas, context2);
  return {
    nodeId: node.id,
    status: "succeeded",
    durationMs: Math.max(1, Date.now() - startedAt),
    tripoTaskId: taskId,
    progress: 100,
    creditsConsumed: task.credits_consumed ?? null,
    output: tripoNodeOutput(node, task, { fallbackPreview })
  };
}

// server/tripo-run.ts
function createTripoRunner(env = process.env, { readAsset: readAsset3 } = {}) {
  if (!isTripoConfigured(env)) return null;
  const client = createTripoClient({ apiKey: env.TRIPO_API_KEY, baseUrl: env.TRIPO_BASE_URL });
  return function createProvider({ context: context2, run, onUpdate, canvas: fullCanvas = null }) {
    const uploads = /* @__PURE__ */ new Map();
    return async function provider(node, executionCanvas) {
      return executeTripoNode(node, fullCanvas || executionCanvas, {
        client,
        context: context2,
        readAsset: readAsset3,
        uploads,
        // Progress is written onto the node run so the canvas can show a percentage
        // while a task that takes minutes is still running.
        onProgress: async ({ tripoTaskId, progress }) => {
          const nodeRun = run.nodeRuns?.[node.id];
          if (!nodeRun) return;
          nodeRun.tripoTaskId = tripoTaskId;
          nodeRun.progress = progress;
          await onUpdate();
        }
      });
    };
  };
}
function createTripoTaskReader(env = process.env) {
  if (!isTripoConfigured(env)) return null;
  const client = createTripoClient({ apiKey: env.TRIPO_API_KEY, baseUrl: env.TRIPO_BASE_URL });
  return (taskId) => client.getTask(taskId);
}

// server/meshy.ts
var DEFAULT_BASE_URL2 = "https://api.meshy.ai";
var RETRY_BASE_MS2 = 1e3;
var RETRY_CAP_MS2 = 32e3;
var MAX_RETRIES2 = 5;
var TERMINAL_FAILURES2 = /* @__PURE__ */ new Set(["FAILED", "CANCELED"]);
var MeshyError = class extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
};
function envValue(name) {
  return typeof process === "undefined" ? void 0 : process.env[name];
}
function isMeshyConfigured(env = { MESHY_API_KEY: envValue("MESHY_API_KEY") }) {
  return Boolean(env.MESHY_API_KEY);
}
function retryDelay2(response, attempt) {
  const header = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1e3, RETRY_CAP_MS2);
  return Math.min(RETRY_BASE_MS2 * 2 ** attempt, RETRY_CAP_MS2);
}
function createMeshyClient({
  apiKey = envValue("MESHY_API_KEY"),
  baseUrl = envValue("MESHY_BASE_URL"),
  fetchImpl = fetch,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  maxRetries = MAX_RETRIES2,
  timeoutMs = 6e4
} = {}) {
  if (!apiKey) throw new MeshyError("Meshy is not configured. Set MESHY_API_KEY.", 503);
  const root6 = (baseUrl || DEFAULT_BASE_URL2).replace(/\/$/, "");
  async function send(path6, { method = "GET", body = null, headers = {} } = {}) {
    let lastResponse = null;
    let lastFailure = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(`${root6}${path6}`, {
          method,
          headers: { authorization: `Bearer ${apiKey}`, ...headers },
          ...body ? { body } : {},
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (failure) {
        if (attempt === maxRetries) throw new MeshyError("The Meshy service is unavailable.", 503);
        lastFailure = failure;
        await wait(Math.min(RETRY_BASE_MS2 * 2 ** attempt, RETRY_CAP_MS2));
        continue;
      }
      if (response.status !== 429 && response.status < 500) return unwrap(response, path6);
      lastResponse = response;
      if (attempt === maxRetries) break;
      await wait(retryDelay2(response, attempt));
    }
    if (!lastResponse) throw new MeshyError("The Meshy service is unavailable.", 503);
    throw new MeshyError(`Meshy request to ${path6} failed with status ${lastResponse.status}.`, lastResponse.status === 429 ? 503 : 502);
  }
  async function unwrap(response, path6) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new MeshyError(`Meshy returned an invalid response for ${path6}.`);
    }
    if (!response.ok) {
      const detail = payload?.message || payload?.error || `status ${response.status}`;
      throw new MeshyError(`Meshy request to ${path6} failed: ${detail}.`, response.status === 401 || response.status === 403 ? 503 : 502);
    }
    return payload;
  }
  return {
    /**
     * Creates a task and returns its id. `endpoint` is the task family's path
     * (`/openapi/v1/image-to-3d` and the like); it doubles as the polling path,
     * so the caller keeps it for `awaitTask`.
     */
    async createTask(endpoint, body) {
      const data = await send(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!data?.result) throw new MeshyError(`Meshy did not return a task id for ${endpoint}.`);
      return data.result;
    },
    async getTask(endpoint, taskId) {
      return send(`${endpoint}/${encodeURIComponent(taskId)}`);
    },
    /**
     * Polls until Meshy itself reports a terminal state.
     *
     * A status request that fails tells us nothing about the task, so it is
     * retried rather than treated as a failed generation: the submitted task is
     * still running on Meshy's side and only Meshy can say it failed.
     */
    async awaitTask(endpoint, taskId, { intervalMs = 2e3, onProgress = () => {
    } } = {}) {
      for (; ; ) {
        let task;
        try {
          task = await this.getTask(endpoint, taskId);
        } catch (failure) {
          console.warn(`[meshy] status lookup for task ${taskId} failed, still polling: ${failure.message}`);
          await wait(intervalMs);
          continue;
        }
        await onProgress(task);
        if (task.status === "SUCCEEDED") return task;
        if (TERMINAL_FAILURES2.has(task.status)) {
          const reason = task.task_error?.message ? `: ${task.task_error.message}` : "";
          throw new MeshyError(`Meshy task ${task.status}${reason} (task ${taskId}).`, 422);
        }
        await wait(intervalMs);
      }
    }
  };
}

// server/meshy-mapping.ts
var meshyNodeTypes = /* @__PURE__ */ new Set([
  "generate-model",
  "text-to-3d",
  "multiview-to-3d",
  "export-model",
  "text-to-image",
  "image-to-image",
  "text-to-motion",
  "remesh",
  "retexture",
  "rigging",
  "animation",
  "convert-model",
  "resize-model",
  "uv-unwrap",
  "print-analyze",
  "print-repair",
  "multi-color-print",
  "auto-split",
  "creative-lab"
]);
var MESHY_NODE_TYPES = meshyNodeTypes;
var TEXTURE_RESOLUTIONS = { standard: "2k", detailed: "4k", extreme: "8k" };
var MAX_TARGET_POLYCOUNT = 3e5;
var MAX_IMAGES = 4;
var STANDARD_MODELS = /* @__PURE__ */ new Set(["latest", "meshy-7.1", "meshy-7", "meshy-6", "meshy-6-lite"]);
function sharedBody(config) {
  const smart = config.modelType === "smart-topology";
  const aiModel = smart ? config.aiModel === "meshy-t2" ? "meshy-t2" : "meshy-t2.5" : STANDARD_MODELS.has(config.aiModel) ? config.aiModel : "latest";
  const body = { ai_model: aiModel, target_formats: ["glb"] };
  if (smart) body.model_type = "smart-topology";
  if (!smart && (aiModel === "latest" || aiModel === "meshy-7.1") && (config.geometryResolution === "2k" || config.geometryResolution === "4k")) {
    body.geometry_resolution = config.geometryResolution;
  }
  body.should_texture = config.texture !== false;
  if (body.should_texture) {
    body.enable_pbr = config.pbr !== false;
    const resolution = TEXTURE_RESOLUTIONS[config.textureQuality] || "2k";
    body.texture_resolution = aiModel === "meshy-6-lite" && resolution !== "2k" ? "2k" : resolution;
  }
  if (config.poseMode === "a-pose" || config.poseMode === "t-pose") body.pose_mode = config.poseMode;
  const faceCount = Number(config.faceCount);
  if (smart) {
    const max = aiModel === "meshy-t2" ? 15e3 : 3e4;
    if (faceCount >= 100) body.target_polycount = Math.min(faceCount, max);
    return body;
  }
  const remesh = typeof config.shouldRemesh === "boolean" ? config.shouldRemesh : config.topology === "quad" || faceCount >= 100 && faceCount <= MAX_TARGET_POLYCOUNT;
  if (remesh) {
    body.should_remesh = true;
    body.topology = config.topology === "quad" ? "quad" : "triangle";
    if (faceCount >= 100 && faceCount <= MAX_TARGET_POLYCOUNT) body.target_polycount = faceCount;
  }
  return body;
}
var IMAGE_MODELS = /* @__PURE__ */ new Set(["nano-banana", "nano-banana-2", "nano-banana-2-lite", "nano-banana-pro", "gpt-image-2", "gpt-image-2-5-flare", "gpt-image-2-5-sunburst"]);
var RETEXTURE_MODELS = /* @__PURE__ */ new Set(["latest", "meshy-6", "meshy-6-lite", "meshy-7"]);
var CREATIVE_LAB = {
  keychain: ["/openapi/creative-lab/keychain/v1/prototype", "/openapi/creative-lab/keychain/v1/build"],
  "fridge-magnet": ["/openapi/creative-lab/fridge-magnet/v1/prototype", "/openapi/creative-lab/fridge-magnet/v1/build"],
  figure: ["/openapi/creative-lab/figure/v1/prototype", "/openapi/creative-lab/figure/v1/build"],
  "vinyl-figure": ["/openapi/creative-lab/vinyl-figure/v1/prototype", "/openapi/creative-lab/vinyl-figure/v1/build"],
  "brick-figure": ["/openapi/creative-lab/brick-figure/v1/prototype", "/openapi/creative-lab/brick-figure/v1/build"],
  lamp: ["/openapi/creative-lab/lamp/v1/prototype", "/openapi/creative-lab/lamp/v1/build"],
  keycap: ["/openapi/creative-lab/keycap/v1/prototype", "/openapi/creative-lab/keycap/v1/build"],
  "fidget-pixel": ["/openapi/creative-lab/fidget-pixel/v1/prototype", "/openapi/creative-lab/fidget-pixel/v1/build"],
  "fidget-collapsible": ["/openapi/creative-lab/fidget-collapsible/v1", null]
};
function imageRequestBody(config, prompt) {
  if (!prompt) throw new Error("This image step needs a text prompt.");
  const body = {
    ai_model: IMAGE_MODELS.has(config.aiModel) ? config.aiModel : "nano-banana",
    prompt
  };
  if (config.generateMultiView) body.generate_multi_view = true;
  else if (config.aspectRatio) body.aspect_ratio = config.aspectRatio;
  if (config.removeBackground) body.remove_background = true;
  if (config.poseMode === "a-pose" || config.poseMode === "t-pose") body.pose_mode = config.poseMode;
  return body;
}
function meshRequestBody(node, mesh, { formats = null } = {}) {
  const body = {};
  if (formats) body.target_formats = formats;
  if (mesh?.taskId) body.input_task_id = mesh.taskId;
  else if (mesh?.modelUrl) body.model_url = mesh.modelUrl;
  else throw new Error(`${node.name || node.type} needs an upstream 3D model.`);
  return body;
}
function buildMeshyTask(node, { input, prompt, images, styleImage, rigTaskId, motionTaskId, mesh, imageTaskId }) {
  const config = node.config || {};
  switch (node.type) {
    case "text-to-image":
      return { endpoint: "/openapi/v1/text-to-image", body: imageRequestBody(config, prompt) };
    case "image-to-image": {
      const body = imageRequestBody(config, prompt);
      if (imageTaskId) body.input_task_id = imageTaskId;
      else {
        const refs = [input, ...images || []].filter(Boolean).slice(0, 5);
        if (!refs.length) throw new Error("Image to Image needs a reference image.");
        body.reference_image_urls = refs;
      }
      return { endpoint: "/openapi/v1/image-to-image", body };
    }
    case "text-to-motion": {
      if (!prompt) throw new Error("Text to Motion needs a text prompt.");
      const duration = Number(config.duration);
      return {
        endpoint: "/openapi/v1/text-to-motion",
        body: { prompt, mode: config.mode === "swift" ? "swift" : "prime", duration: duration >= 2 && duration <= 10 ? duration : 3 }
      };
    }
    case "remesh": {
      const body = meshRequestBody(node, mesh, { formats: ["glb"] });
      body.topology = config.topology === "quad" ? "quad" : "triangle";
      const faces = Number(config.faceCount);
      if (faces >= 100 && faces <= MAX_TARGET_POLYCOUNT) body.target_polycount = faces;
      return { endpoint: "/openapi/v1/remesh", body };
    }
    case "retexture": {
      const body = meshRequestBody(node, mesh);
      body.ai_model = RETEXTURE_MODELS.has(config.aiModel) ? config.aiModel : "latest";
      body.enable_pbr = config.pbr !== false;
      body.enable_original_uv = config.enableOriginalUv === true;
      const resolution = TEXTURE_RESOLUTIONS[config.textureQuality] || "2k";
      body.texture_resolution = body.ai_model === "meshy-6-lite" && resolution !== "2k" ? "2k" : resolution;
      if (config.styleMode === "image") {
        if (!styleImage) throw new Error("Retexture needs a style image.");
        body.image_style_url = styleImage;
      } else if (prompt) {
        body.text_style_prompt = prompt;
      } else {
        throw new Error("Retexture needs a style prompt or a style image.");
      }
      return { endpoint: "/openapi/v1/retexture", body };
    }
    case "rigging": {
      const body = meshRequestBody(node, mesh);
      delete body.target_formats;
      const height = Number(config.heightMeters);
      if (height > 0) body.height_meters = height;
      return { endpoint: "/openapi/v1/rigging", body };
    }
    case "animation": {
      if (!rigTaskId) throw new Error("Animation needs an upstream Rigging task.");
      const body = { rig_task_id: rigTaskId };
      if (motionTaskId) body.motion_task_id = motionTaskId;
      else body.action_id = Number.isFinite(Number(config.actionId)) ? Number(config.actionId) : 0;
      if (config.postProcess === "change_fps" || config.postProcess === "fbx2usdz" || config.postProcess === "extract_armature") {
        body.post_process = { operation_type: config.postProcess };
        if (config.postProcess === "change_fps") body.post_process.fps = [24, 25, 30, 60].includes(Number(config.fps)) ? Number(config.fps) : 30;
      }
      return { endpoint: "/openapi/v1/animations", body };
    }
    case "convert-model": {
      const format = ["glb", "fbx", "obj", "usdz", "blend", "stl", "3mf"].includes(config.targetFormat) ? config.targetFormat : "fbx";
      return { endpoint: "/openapi/v1/convert", body: meshRequestBody(node, mesh, { formats: [format] }) };
    }
    case "resize-model": {
      const body = meshRequestBody(node, mesh);
      if (config.resizeMode === "longest") body.resize_longest_side = Number(config.resizeLength) || 1;
      else if (config.resizeMode === "auto") {
        body.auto_size = true;
        body.origin_at = config.originAt === "center" ? "center" : "bottom";
      } else body.resize_height = Number(config.resizeHeight) || 1;
      return { endpoint: "/openapi/v1/resize", body };
    }
    case "uv-unwrap":
      return { endpoint: "/openapi/v1/uv-unwrap", body: meshRequestBody(node, mesh) };
    case "print-analyze":
      return { endpoint: "/openapi/v1/print/analyze", body: meshRequestBody(node, mesh) };
    case "print-repair":
      return { endpoint: "/openapi/v1/print/repair", body: meshRequestBody(node, mesh) };
    case "multi-color-print": {
      const body = meshRequestBody(node, mesh);
      const brands = ["bambu", "anycubic", "creality", "elegoo", "flashforge", "prusa", "qidi", "snapmaker", "ankermake"];
      body.printer_brand = brands.includes(config.printerBrand) ? config.printerBrand : "bambu";
      return { endpoint: "/openapi/v1/print/multi-color", body };
    }
    case "auto-split": {
      const body = meshRequestBody(node, mesh, { formats: ["glb"] });
      body.mode = config.splitMode === "by_parts" || config.splitMode === "by_color" ? config.splitMode : "auto";
      body.layout = config.layout === "on_plate" ? "on_plate" : "assembled";
      if (body.mode !== "auto") {
        if (!prompt) throw new Error("Auto Split needs a prompt naming the parts.");
        body.prompt = prompt;
      }
      if (config.connectors) {
        body.connectors = true;
        body.connector_type = config.connectorType === "cylinder" ? "cylinder" : "cube";
      }
      return { endpoint: "/openapi/v1/print/split", body };
    }
    case "creative-lab": {
      if (!input) throw new Error("Creative Lab needs an image.");
      const [prototype, build] = CREATIVE_LAB[config.product] || CREATIVE_LAB.keychain;
      const body = { image_url: input };
      if ((config.product || "keychain") === "keychain" && config.nameText) body.name_text = String(config.nameText).trim().slice(0, 10);
      return {
        endpoint: prototype,
        body,
        refine: build ? (taskId) => ({ endpoint: build, body: { input_task_id: taskId } }) : null
      };
    }
    default:
      return null;
  }
}
function meshyRequest(node, { input = null, prompt = "", multiview = null, mesh = null, images = null, styleImage = null, rigTaskId = null, motionTaskId = null, imageTaskId = null } = {}) {
  if (node.type === "text-to-3d") {
    if (!prompt) throw new Error("Text to 3D needs a text prompt.");
    return generateModelRequest2({ ...node, type: "generate-model" }, { prompt });
  }
  if (node.type === "multiview-to-3d") {
    if (!multiview?.length) throw new Error("Multi-view to 3D needs a front view and at least one more view.");
    return generateModelRequest2({ ...node, type: "generate-model" }, { multiview });
  }
  if (node.type !== "generate-model") return buildMeshyTask(node, { input, prompt, images, styleImage, rigTaskId, motionTaskId, mesh, imageTaskId });
  return generateModelRequest2(node, { input, prompt, multiview });
}
function generateModelRequest2(node, { input = null, prompt = "", multiview = null }) {
  const config = node.config || {};
  const body = sharedBody(config);
  if (multiview) return { endpoint: "/openapi/v1/multi-image-to-3d", body: { ...body, image_urls: multiview.slice(0, MAX_IMAGES) } };
  if (input) return { endpoint: "/openapi/v1/image-to-3d", body: { ...body, image_url: input } };
  if (prompt) {
    const { should_texture: shouldTexture, enable_pbr: enablePbr, texture_resolution: textureResolution, ...preview } = body;
    return {
      endpoint: "/openapi/v2/text-to-3d",
      body: { ...preview, mode: "preview", prompt },
      refine: shouldTexture ? (previewTaskId) => ({
        endpoint: "/openapi/v2/text-to-3d",
        body: { mode: "refine", preview_task_id: previewTaskId, enable_pbr: enablePbr, texture_resolution: textureResolution, target_formats: ["glb"] }
      }) : null
    };
  }
  throw new Error("Gen HD Model needs an upstream image or a text prompt.");
}
function usesMeshy(node) {
  return MESHY_NODE_TYPES.has(node.type);
}
function taskModelUrl(task) {
  const urls = task?.model_urls || {};
  return urls.glb || urls.fbx || urls.obj || urls.usdz || urls.stl || urls.blend || urls["3mf"] || urls.lamp_stl || urls.base_stl || task?.animation_glb_url || task?.animation_fbx_url || task?.rigged_character_glb_url || task?.rigged_character_fbx_url || task?.motion_url || null;
}
function meshyNodeOutput(node, task, { preview = null, modelUrl = null, fallbackPreview = null } = {}) {
  const images = Array.isArray(task?.image_urls) ? task.image_urls.filter((url) => typeof url === "string" && url) : [];
  const resolvedPreview = preview || task?.thumbnail_url || images[0] || fallbackPreview || null;
  const resolvedModel = modelUrl || taskModelUrl(task);
  const taskId = task?.id || null;
  const extension = resolvedModel?.split("?")[0].split(".").pop()?.toLowerCase();
  const format = ["glb", "fbx", "obj", "usdz", "stl", "blend", "3mf", "bvh"].includes(extension) ? extension : "glb";
  const ports = {};
  if (images[0]) ports.image = images[0];
  if (images.length >= 2) {
    ports.front = images[0];
    ports.side = images[1];
    if (images[2]) ports.back = images[2];
  }
  const report = task?.printability || task?.print_repair_report || null;
  return {
    message: report ? `${node.name || node.type} finished` : `${node.name || node.type} generated`,
    preview: resolvedPreview,
    modelUrl: resolvedModel,
    meshyTaskId: taskId,
    creditsConsumed: task?.consumed_credits ?? null,
    ...Object.keys(ports).length ? { ports } : {},
    ...report ? { report } : {},
    outputs: taskId && resolvedModel ? [{ format, filename: `model.${format === "gltf" ? "glb" : format}`, downloadUrl: resolvedModel }] : []
  };
}

// server/meshy-provider.ts
var IMAGE_MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp"
};
var MESHY_PREVIEW_TASK = "__MESHY_PREVIEW_TASK__";
function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(view).toString("base64");
  let binary = "";
  const size = 32768;
  for (let index = 0; index < view.length; index += size) {
    binary += String.fromCharCode(...view.subarray(index, index + size));
  }
  return btoa(binary);
}
async function toMeshyInput(reference, { readLocal, binary = false } = {}) {
  if (!reference || typeof reference !== "string") return null;
  if (/^https?:\/\//.test(reference) || reference.startsWith("data:")) return reference;
  if (!readLocal) throw new Error(`The reference "${reference}" is not a supported image source.`);
  const file = await readLocal(reference);
  if (!file?.bytes) throw new Error("The upstream asset could not be read.");
  const filename = file.filename || "asset";
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const mime = binary ? "application/octet-stream" : IMAGE_MIME_BY_EXTENSION[extension] || "application/octet-stream";
  return `data:${mime};base64,${toBase64(file.bytes)}`;
}
var IMAGE_TASK_TYPES = /* @__PURE__ */ new Set(["text-to-image", "image-to-image"]);
async function resolveMesh(node, canvas, context2, toInput, portId = null) {
  const sources = resolveInputSources(node, canvas);
  const ports = nodeInputPorts(node.type).filter((port) => (port.type === "model" || port.type === "any") && (!portId || port.id === portId));
  for (const port of ports) {
    const source = (sources[port.id] || [])[0];
    if (!source) continue;
    const produced = context2.get(source.node.id);
    if (produced?.meshyTaskId) return { taskId: produced.meshyTaskId, modelUrl: produced.modelUrl || null, sourceType: source.node.type };
    const value = nodeOutputPortValues(source.node, produced)[source.portId];
    if (typeof value === "string" && value) return { modelUrl: await toInput(value, { binary: true }), sourceType: source.node.type };
  }
  return null;
}
async function executeMeshyNode(node, canvas, {
  client,
  context: context2 = /* @__PURE__ */ new Map(),
  readLocal,
  onProgress = async () => {
  },
  pollIntervalMs = 2e3,
  // `0` submits the task and returns while Meshy is still working. The Worker
  // uses this because `waitUntil` ends 30 seconds after the response.
  pollBudgetMs = null
} = {}) {
  if (!usesMeshy(node)) return null;
  const startedAt = Date.now();
  if (node.type === "export-model") {
    const sources = resolveInputSources(node, canvas);
    const modelPort = nodeInputPorts(node.type).find((port) => port.type === "model");
    const source = (sources[modelPort?.id] || [])[0];
    const produced = source ? context2.get(source.node.id) : null;
    const modelUrl = produced?.modelUrl || (source ? nodeOutputPortValues(source.node, produced)[modelPort.id] : null);
    if (!modelUrl) throw new Error(`${node.name || "Export"} needs an upstream 3D model.`);
    const fileName = node.config?.fileName || "model";
    return {
      nodeId: node.id,
      status: "succeeded",
      durationMs: Math.max(1, Date.now() - startedAt),
      progress: 100,
      output: {
        message: `${node.name || "Export"} ready`,
        target: "3D Model",
        format: "gltf",
        modelUrl,
        outputs: [{ destination: "dcc", format: "gltf", filename: `${fileName}.glb`, downloadUrl: modelUrl }]
      }
    };
  }
  const toInput = (reference, options2) => toMeshyInput(reference, { readLocal, ...options2 });
  const imageNodes = node.type === "generate-model" || node.type === "multiview-to-3d" || node.type === "image-to-image" || node.type === "creative-lab" || node.type === "retexture";
  const resolved = imageNodes ? await resolveGenerateModelImages(node, canvas, context2, { toInput, labeledViews: false }) : {};
  const mesh = await resolveMesh(node, canvas, context2, toInput, node.type === "animation" ? "model" : null);
  const motion = node.type === "animation" ? await resolveMesh(node, canvas, context2, toInput, "motion") : null;
  const styleImage = node.type === "retexture" && node.config?.styleMode === "image" ? await toInput(resolveStyleImage(node, canvas, context2)) : null;
  const request = meshyRequest(node, {
    input: resolved.input ?? null,
    prompt: resolvePrompt(node, canvas),
    multiview: resolved.multiview ?? null,
    images: resolved.multiview ?? null,
    mesh,
    styleImage,
    rigTaskId: mesh?.sourceType === "rigging" ? mesh.taskId : null,
    motionTaskId: motion?.sourceType === "text-to-motion" ? motion.taskId : null,
    imageTaskId: imageTaskFrom(node, canvas, context2)
  });
  if (!request) return null;
  const taskId = await client.createTask(request.endpoint, request.body);
  const meshyFollowup = request.refine ? request.refine(MESHY_PREVIEW_TASK) : null;
  const scale = request.refine ? (progress) => Math.round(progress / 2) : (progress) => progress;
  const handedOff = pollBudgetMs === 0;
  await onProgress({ meshyTaskId: taskId, meshyTaskEndpoint: request.endpoint, meshyFollowup, meshyHandedOff: handedOff, progress: 0 });
  if (handedOff) {
    return {
      nodeId: node.id,
      status: "running",
      durationMs: Math.max(1, Date.now() - startedAt),
      meshyTaskId: taskId,
      meshyTaskEndpoint: request.endpoint,
      meshyFollowup,
      meshyHandedOff: true,
      progress: 0,
      output: null
    };
  }
  let task = await client.awaitTask(request.endpoint, taskId, {
    intervalMs: pollIntervalMs,
    onProgress: (current) => onProgress({ meshyTaskId: taskId, progress: scale(current.progress ?? 0) })
  });
  let endpoint = request.endpoint;
  let creditsConsumed = task.consumed_credits ?? null;
  if (request.refine) {
    const followup = request.refine(taskId);
    endpoint = followup.endpoint;
    const refineTaskId = await client.createTask(followup.endpoint, followup.body);
    await onProgress({ meshyTaskId: refineTaskId, progress: 50 });
    const previewCredits = task.consumed_credits ?? null;
    task = await client.awaitTask(followup.endpoint, refineTaskId, {
      intervalMs: pollIntervalMs,
      onProgress: (current) => onProgress({ meshyTaskId: refineTaskId, progress: 50 + Math.round((current.progress ?? 0) / 2) })
    });
    creditsConsumed = (previewCredits ?? 0) + (task.consumed_credits ?? 0) || null;
  }
  return {
    nodeId: node.id,
    status: "succeeded",
    durationMs: Math.max(1, Date.now() - startedAt),
    meshyTaskId: task.id,
    meshyTaskEndpoint: endpoint,
    progress: 100,
    creditsConsumed,
    output: meshyNodeOutput(node, task, { fallbackPreview: resolveUpstreamPreview(node, canvas, context2) })
  };
}
function imageTaskFrom(node, canvas, context2) {
  const sources = resolveInputSources(node, canvas);
  for (const source of sources.image || []) {
    const produced = context2.get(source.node.id);
    if (produced?.meshyTaskId && IMAGE_TASK_TYPES.has(source.node.type)) return produced.meshyTaskId;
  }
  return null;
}
function resolveStyleImage(node, canvas, context2) {
  const sources = resolveInputSources(node, canvas);
  const source = (sources.image || [])[0];
  if (!source) return null;
  const value = nodeOutputPortValues(source.node, context2.get(source.node.id))[source.portId];
  return typeof value === "string" ? value : null;
}

// server/meshy-run.ts
function createMeshyRunner(env = {}, { readLocal, pollBudgetMs = null } = {}) {
  if (!isMeshyConfigured(env)) return null;
  const client = createMeshyClient({ apiKey: env.MESHY_API_KEY, baseUrl: env.MESHY_BASE_URL });
  return function createProvider({ context: context2, run, onUpdate, canvas: fullCanvas = null }) {
    return async function provider(node, executionCanvas) {
      return executeMeshyNode(node, fullCanvas || executionCanvas, {
        client,
        context: context2,
        readLocal,
        pollBudgetMs,
        // Progress is written onto the node run so the canvas can show a percentage
        // while a task that takes minutes is still running.
        onProgress: async ({ meshyTaskId, meshyTaskEndpoint, meshyFollowup, meshyHandedOff, progress }) => {
          const nodeRun = run.nodeRuns?.[node.id];
          if (!nodeRun) return;
          nodeRun.meshyTaskId = meshyTaskId;
          if (meshyTaskEndpoint) nodeRun.meshyTaskEndpoint = meshyTaskEndpoint;
          if (meshyFollowup) nodeRun.meshyFollowup = meshyFollowup;
          if (meshyHandedOff) nodeRun.meshyHandedOff = true;
          nodeRun.progress = progress;
          await onUpdate();
        }
      });
    };
  };
}
function createMeshySubmitter(env = {}) {
  if (!isMeshyConfigured(env)) return null;
  const client = createMeshyClient({ apiKey: env.MESHY_API_KEY, baseUrl: env.MESHY_BASE_URL });
  return (endpoint, body) => client.createTask(endpoint, body);
}
function createMeshyTaskReader(env = {}) {
  if (!isMeshyConfigured(env)) return null;
  const client = createMeshyClient({ apiKey: env.MESHY_API_KEY, baseUrl: env.MESHY_BASE_URL, maxRetries: 0, timeoutMs: 8e3 });
  const endpoints = [
    "/openapi/v2/text-to-3d",
    "/openapi/v1/image-to-3d",
    "/openapi/v1/multi-image-to-3d",
    "/openapi/v1/text-to-image",
    "/openapi/v1/image-to-image",
    "/openapi/v1/text-to-motion",
    "/openapi/v1/remesh",
    "/openapi/v1/retexture",
    "/openapi/v1/rigging",
    "/openapi/v1/animations",
    "/openapi/v1/convert",
    "/openapi/v1/resize",
    "/openapi/v1/uv-unwrap",
    "/openapi/v1/print/analyze",
    "/openapi/v1/print/repair",
    "/openapi/v1/print/multi-color",
    "/openapi/v1/print/split",
    "/openapi/creative-lab/keychain/v1/build",
    "/openapi/creative-lab/fridge-magnet/v1/build",
    "/openapi/creative-lab/figure/v1/build",
    "/openapi/creative-lab/vinyl-figure/v1/build",
    "/openapi/creative-lab/brick-figure/v1/build",
    "/openapi/creative-lab/lamp/v1/build",
    "/openapi/creative-lab/keycap/v1/build",
    "/openapi/creative-lab/fidget-pixel/v1/build",
    "/openapi/creative-lab/fidget-collapsible/v1"
  ];
  return async (taskId, endpoint = null) => {
    if (endpoint) return client.getTask(endpoint, taskId);
    let lastFailure;
    for (const candidate of endpoints) {
      try {
        return await client.getTask(candidate, taskId);
      } catch (failure) {
        if (failure?.status === 503) throw failure;
        lastFailure = failure;
      }
    }
    throw lastFailure;
  };
}

// server/meshy-local-file.ts
import { readFile as readFile4 } from "node:fs/promises";
import path5 from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";
var root5 = path5.dirname(fileURLToPath5(import.meta.url));
var publicDirectory2 = path5.join(root5, "..", "public");
function createMeshyLocalReader(readAsset3) {
  return async function readLocal(reference) {
    if (reference.startsWith(assetUrlPrefix)) {
      const assetId = reference.slice(assetUrlPrefix.length);
      if (readAsset3) {
        const asset = await readAsset3(assetId);
        if (!asset) throw new Error("The upstream asset could not be read.");
        return { bytes: asset.bytes, filename: assetId };
      }
      const resolved = resolveAssetPath(assetId);
      if (!resolved) throw new Error("The upstream asset could not be read.");
      return { bytes: await readFile4(resolved), filename: path5.basename(resolved) };
    }
    if (reference.startsWith("/")) {
      const resolved = path5.join(publicDirectory2, reference);
      if (!resolved.startsWith(publicDirectory2 + path5.sep)) throw new Error("The reference image path is not allowed.");
      const bytes = await readFile4(resolved).catch(() => {
        throw new Error(`The reference file ${reference} is missing.`);
      });
      return { bytes, filename: path5.basename(resolved) };
    }
    throw new Error(`The reference "${reference}" is not a supported image source.`);
  };
}

// server/user-keys.ts
var USER_KEY_COOKIES = {
  deepseek: "forge3d_deepseek_key",
  meshy: "forge3d_meshy_key"
};
var USER_KEY_HEADERS = {
  deepseek: "x-forge3d-deepseek-key",
  meshy: "x-forge3d-meshy-key"
};
var MAX_KEY_LENGTH = 256;
function readUserKeys(request) {
  const cookies = /* @__PURE__ */ new Map();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    try {
      cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
    } catch {
    }
  }
  const value = (cookie, header) => {
    const key = (request.headers.get(header) || cookies.get(cookie) || "").trim();
    return key.length <= MAX_KEY_LENGTH ? key : "";
  };
  return {
    deepseek: value(USER_KEY_COOKIES.deepseek, USER_KEY_HEADERS.deepseek),
    meshy: value(USER_KEY_COOKIES.meshy, USER_KEY_HEADERS.meshy)
  };
}
function applyUserKeys(config, keys, createMeshy) {
  if (!keys.deepseek && !keys.meshy) return config;
  return {
    ...config,
    deepseek: { ...config.deepseek, apiKey: keys.deepseek || config.deepseek?.apiKey },
    ...keys.meshy ? withBuiltInTaskReads(createMeshy(keys.meshy), config.getMeshyTask) : {}
  };
}
function withBuiltInTaskReads(ports, builtInRead) {
  if (!builtInRead || !ports.getMeshyTask) return ports;
  const ownRead = ports.getMeshyTask;
  return {
    ...ports,
    getMeshyTask: async (taskId, endpoint) => {
      try {
        return await ownRead(taskId, endpoint);
      } catch {
        return builtInRead(taskId, endpoint);
      }
    }
  };
}

// server/ids.ts
function randomUUID() {
  return globalThis.crypto.randomUUID();
}

// server/node-state.ts
function latestNodeRuns(canvas, runs) {
  const nodeIds = new Set(canvas.nodes.map((node) => node.id));
  const latest = {};
  for (const run of runs) {
    if (run.canvasId !== canvas.id || run.canvasRevision !== canvas.revision) continue;
    for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns)) {
      if (nodeIds.has(nodeId)) latest[nodeId] = nodeRun;
    }
  }
  return latest;
}

// server/run-assets.ts
var REFERENCE_TYPES = /* @__PURE__ */ new Set(["reference-image"]);
var IMAGE_TYPES = /* @__PURE__ */ new Set(["generate-image", "generated-image", "image-decomposition", "generate-multiview-images", "review"]);
var MODEL_TYPES = /* @__PURE__ */ new Set(["generate-model", "smart-mesh", "multiview-to-3d", "text-to-3d", "texture", "retopology", "rigging", "segments", "model-preview", "export-model"]);
function assetKind(nodeType) {
  if (REFERENCE_TYPES.has(nodeType)) return "reference";
  if (IMAGE_TYPES.has(nodeType)) return "image";
  if (MODEL_TYPES.has(nodeType)) return "model";
  return null;
}
function assetSources(output) {
  const batch = [
    ...Array.isArray(output.previews) ? output.previews : [],
    ...Object.values(output.viewPreviews || {})
  ].filter(Boolean);
  if (batch.length) return batch;
  const single = output.image || output.preview;
  return single ? [single] : [];
}
function collectRunAssets(runs, canvasId, canvas = null) {
  const nodeTypes = new Map((canvas?.nodes || []).map((node) => [node.id, node.type]));
  const assets = [];
  for (const run of runs) {
    if (run.canvasId !== canvasId) continue;
    const createdAt = run.completedAt || run.createdAt;
    for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns || {})) {
      if (!nodeRun.output) continue;
      const nodeType = nodeRun.nodeType || nodeTypes.get(nodeId) || "";
      const kind = assetKind(nodeType);
      if (!kind) continue;
      const downloads = Array.isArray(nodeRun.output.outputs) ? nodeRun.output.outputs.filter((output) => output.downloadUrl) : [];
      assetSources(nodeRun.output).forEach((src, index) => assets.push({
        id: `${run.id}:${nodeId}:${index}`,
        runId: run.id,
        executionId: run.id,
        canvasId: run.canvasId,
        canvasRevision: run.canvasRevision,
        entryNodeId: run.entryNodeId || Object.keys(run.nodeRuns || {})[0],
        nodeId,
        producerNodeId: nodeId,
        nodeType,
        producerNodeType: nodeType,
        label: nodeRun.nodeName || nodeType,
        producerNodeName: nodeRun.nodeName || nodeType,
        kind,
        src,
        downloads,
        status: nodeRun.status,
        createdAt
      }));
    }
  }
  return assets.sort((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
}
function executionAssets(runs, { canvasId, nodeId, executionId, kind } = {}) {
  const selectedRuns = runs.filter((run) => (!canvasId || run.canvasId === canvasId) && (!executionId || run.id === executionId));
  return collectRunAssets(selectedRuns, canvasId).filter((asset) => (!nodeId || asset.producerNodeId === nodeId) && (!kind || asset.kind === kind));
}

// src/result-traversal.ts
function nodeTypeOf(node) {
  return node.data?.canvasType || node.type || "";
}
function stagesOnlyEdges(nodes, edges, isResult, stageOfSlot) {
  const typeById = new Map(nodes.map((node) => [node.id, nodeTypeOf(node)]));
  const stage = (nodeId) => isResult(typeById.get(nodeId) || "") ? stageOfSlot(nodeId) : nodeId;
  const seen = /* @__PURE__ */ new Set();
  const resolved = [];
  for (const edge of edges) {
    const source = stage(edge.source);
    const target = stage(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ ...edge, source, target });
  }
  return resolved;
}

// server/mock-runs.ts
var demoConceptImages = ["/shark-concept-front.png", "/shark-concept-left.png", "/shark-concept-right.png", "/shark-concept-back.png"];
var demoViewImages = { front: "/shark-concept-front.png", back: "/shark-concept-back.png", left: "/shark-concept-left.png", right: "/shark-concept-right.png" };
var demoModelImages = { retopology: "/shark-retopology.png", texture: "/shark-textured.png", "model-preview": "/shark-review.png" };
var demoModelUrl = "/models/shark-gardener.glb";
function demoModelImage(type) {
  return demoModelImages[type] || "/shark-model.png";
}
function asList(value) {
  return value == null ? [] : [...new Set([value].flat().filter(Boolean))];
}
function resolveInputImages(node, canvas) {
  return asList(resolveNodeInputs(node, canvas).image);
}
function resolveInputImage(node, canvas) {
  return resolveInputImages(node, canvas)[0] || null;
}
function exportTarget(node, canvas) {
  const inputs = resolveNodeInputs(node, canvas);
  if (inputs.model) return "3D Model";
  return inputs.image ? "Image" : "3D Model";
}
function nodeOutput(node, canvas) {
  if (["reference-image", "generated-image"].includes(node.type)) {
    const image = resolveInputImage(node, canvas) || null;
    return { message: `${node.name} ready`, image, preview: image };
  }
  if (node.type === "generate-image" || node.type === "text-to-image" || node.type === "image-to-image") {
    const all = node.generatedAssets?.previews?.length ? node.generatedAssets.previews : demoConceptImages;
    const count = Number(node.config?.amount) > 0 ? Number(node.config.amount) : all.length;
    const previews = all.slice(0, count);
    const selected = previews.includes(node.generatedAssets?.selectedPreview) ? node.generatedAssets.selectedPreview : previews[0] || null;
    return { message: "Image candidates generated", previews, image: selected };
  }
  if (node.type === "image-decomposition") {
    const all = node.generatedAssets?.previews?.length ? node.generatedAssets.previews : demoConceptImages;
    const previews = all.slice(0, Number(node.config?.amount) || 4);
    return { message: "Image assets extracted", previews, image: previews[0] || null };
  }
  if (node.type === "generate-multiview-images") {
    const viewPreviews = Object.keys(node.generatedAssets?.viewPreviews || {}).length ? node.generatedAssets.viewPreviews : demoViewImages;
    return { message: "Front, back, left, and right views generated", viewPreviews, ports: { ...viewPreviews } };
  }
  if (node.type === "review") {
    const image = resolveInputImage(node, canvas) || null;
    return { message: node.generatedAssets?.approved ? "Image approved" : "Awaiting image approval", image, preview: image };
  }
  if (["generate-model", "smart-mesh", "multiview-to-3d", "text-to-3d", "retopology", "texture", "rigging", "segments", "model-preview", "remesh", "retexture", "animation", "text-to-motion", "convert-model", "resize-model", "uv-unwrap", "print-repair", "multi-color-print", "auto-split", "creative-lab"].includes(node.type)) {
    if (node.type === "generate-model") {
      const inputImages = resolveInputImages(node, canvas);
      return { message: `${node.name} generated from ${inputImages.length > 1 ? `${inputImages.length} images` : inputImages.length === 1 ? "1 image" : "text"}`, preview: demoModelImage(node.type), modelUrl: demoModelUrl, inputMode: inputImages.length > 1 ? "multi-image" : inputImages.length === 1 ? "single-image" : "text", inputImages };
    }
    return node.type === "texture" ? { message: "UV texture generated", preview: demoModelImage(node.type), modelUrl: demoModelUrl, textureQuality: node.config?.textureQuality || "detailed" } : { message: `${node.name} generated`, preview: demoModelImage(node.type), modelUrl: demoModelUrl };
  }
  if (node.type === "print-analyze") return { message: `${node.name || "Print Check"} finished`, preview: null };
  if (node.type === "export-model") {
    const format = ["usdz", "fbx", "obj", "stl", "gltf", "3mf"].includes(node.config?.modelFormat) ? node.config.modelFormat : "gltf";
    const fileName = node.config?.fileName || "shark-gardener";
    const outputs = [{ destination: "dcc", format, filename: `${fileName}.${format === "gltf" ? "glb" : format}`, downloadUrl: "/models/shark-gardener.glb", mock: format !== "gltf" }];
    return { message: `${node.name} ready`, target: exportTarget(node, canvas), format, outputs, preview: "/shark-model.png", modelUrl: outputs[0].downloadUrl };
  }
  return { message: `Mock ${node.type} result` };
}
function executionNodes(canvas) {
  const executableNodes = canvas.nodes.filter((node) => isExecutableNodeType(node.type));
  const nodesById = new Map(executableNodes.map((node) => [node.id, node]));
  const outgoing = new Map(executableNodes.map((node) => [node.id, []]));
  const indegree = new Map(executableNodes.map((node) => [node.id, 0]));
  const dependencies = /* @__PURE__ */ new Set();
  for (const edge of canvas.edges || []) {
    const sourceId = edge.source?.nodeId;
    const targetId = edge.target?.nodeId;
    if (!nodesById.has(sourceId) || !nodesById.has(targetId) || dependencies.has(`${sourceId}:${targetId}`)) continue;
    dependencies.add(`${sourceId}:${targetId}`);
    outgoing.get(sourceId).push(targetId);
    indegree.set(targetId, indegree.get(targetId) + 1);
  }
  const queued = executableNodes.filter((node) => indegree.get(node.id) === 0);
  const ordered = [];
  while (queued.length) {
    const node = queued.shift();
    ordered.push(node);
    for (const targetId of outgoing.get(node.id)) {
      indegree.set(targetId, indegree.get(targetId) - 1);
      if (indegree.get(targetId) === 0) queued.push(nodesById.get(targetId));
    }
  }
  return ordered.length === executableNodes.length ? ordered : executableNodes;
}
function downstreamCanvas(canvas, startNodeId) {
  const executableNodes = canvas.nodes.filter((node) => isExecutableNodeType(node.type));
  const nodeIds = new Set(executableNodes.map((node) => node.id));
  if (!nodeIds.has(startNodeId)) return null;
  const outgoing = new Map(executableNodes.map((node) => [node.id, []]));
  for (const edge of canvas.edges || []) {
    const sourceId = edge.source?.nodeId;
    const targetId = edge.target?.nodeId;
    if (outgoing.has(sourceId) && nodeIds.has(targetId)) outgoing.get(sourceId).push(targetId);
  }
  const includedNodeIds = /* @__PURE__ */ new Set([startNodeId]);
  const queued = [startNodeId];
  while (queued.length) {
    const nodeId = queued.shift();
    for (const targetId of outgoing.get(nodeId)) {
      if (includedNodeIds.has(targetId)) continue;
      includedNodeIds.add(targetId);
      queued.push(targetId);
    }
  }
  return {
    ...structuredClone(canvas),
    nodes: executableNodes.filter((node) => includedNodeIds.has(node.id)).map((node) => structuredClone(node)),
    edges: (canvas.edges || []).filter((edge) => includedNodeIds.has(edge.source?.nodeId) && includedNodeIds.has(edge.target?.nodeId)).map((edge) => structuredClone(edge))
  };
}
async function executeNode(node, canvas, {
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  provider = null
} = {}) {
  if (node.config?.mockFailure) {
    const error = new Error(`Mock ${node.type} execution failed`);
    error.statusCode = 422;
    throw error;
  }
  if (provider) {
    const produced = await provider(node, canvas);
    if (produced) return produced;
    const error = new Error(`${node.name || node.type} is not supported by the selected provider`);
    error.statusCode = 422;
    throw error;
  }
  const startedAt = Date.now();
  await wait(5e3);
  const status = node.type === "review" && !node.generatedAssets?.approved ? "waiting_review" : "succeeded";
  return {
    nodeId: node.id,
    status,
    durationMs: Math.max(1, Date.now() - startedAt),
    output: nodeOutput(node, canvas)
  };
}

// server/run-log.ts
function recordNodeExecution(runs, { runId, canvas, node, result, entryNode = node, mode = "node", now = () => (/* @__PURE__ */ new Date()).toISOString() }) {
  const timestamp = now();
  const id = runId || `run-${randomUUID()}`;
  const nodeRun = {
    status: result.status,
    nodeType: node.type,
    nodeName: node.name || node.type,
    durationMs: result.durationMs ?? null,
    output: result.output ?? null,
    error: result.error ?? null,
    // Only present when a real backend produced this node.
    ...result.tripoTaskId ? { tripoTaskId: result.tripoTaskId } : {},
    ...result.meshyTaskId ? { meshyTaskId: result.meshyTaskId } : {},
    ...result.meshyTaskEndpoint ? { meshyTaskEndpoint: result.meshyTaskEndpoint } : {},
    ...result.progress === void 0 ? {} : { progress: result.progress },
    ...result.creditsConsumed === void 0 || result.creditsConsumed === null ? {} : { creditsConsumed: result.creditsConsumed }
  };
  let run = runs.find((candidate) => candidate.id === id && candidate.canvasId === canvas.id);
  if (!run) {
    run = {
      id,
      canvasId: canvas.id,
      canvasRevision: canvas.revision,
      entryNodeId: entryNode.id,
      entryNodeType: entryNode.type,
      entryNodeName: entryNode.name || entryNode.type,
      mode,
      status: nodeRun.status,
      createdAt: timestamp,
      completedAt: timestamp,
      nodeRuns: {}
    };
    runs.push(run);
  }
  run.nodeRuns[node.id] = nodeRun;
  run.canvasRevision = canvas.revision;
  run.status = runStatus(run.nodeRuns);
  run.completedAt = timestamp;
  return run;
}
function runStatus(nodeRuns) {
  const statuses = Object.values(nodeRuns).map((nodeRun) => nodeRun.status);
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("waiting_review")) return "waiting_review";
  if (statuses.some((status) => ["queued", "running"].includes(status))) return "running";
  return "succeeded";
}

// server/executions.ts
var TRIPO_FAILURE_STATUSES = /* @__PURE__ */ new Set(["failed", "banned", "expired", "cancelled"]);
var ACTIVE_EXECUTION_STATUSES = /* @__PURE__ */ new Set(["queued", "running", "cancelling"]);
var MAX_ACTIVE_EXECUTIONS_PER_PROJECT = 3;
function assertProjectExecutionCapacity(runs, projectId) {
  const activeTaskCount = runs.filter((run) => (run.projectId || run.canvasId) === projectId && ACTIVE_EXECUTION_STATUSES.has(run.status)).length;
  if (activeTaskCount < MAX_ACTIVE_EXECUTIONS_PER_PROJECT) return;
  const error = new Error(`This project already has ${activeTaskCount} active tasks. Wait for one to finish before creating another.`);
  error.statusCode = 409;
  error.code = "ACTIVE_TASK_LIMIT_REACHED";
  error.limit = MAX_ACTIVE_EXECUTIONS_PER_PROJECT;
  error.activeTaskCount = activeTaskCount;
  throw error;
}
async function syncExecutionWithTripo(run, getTripoTask2) {
  if (!run || !getTripoTask2) return run;
  const remoteNodes = Object.entries(run.nodeRuns || {}).filter(([, nodeRun]) => nodeRun.tripoTaskId);
  if (!remoteNodes.length) return run;
  let changed = false;
  await Promise.all(remoteNodes.map(async ([nodeId, nodeRun]) => {
    let task;
    try {
      task = await getTripoTask2(nodeRun.tripoTaskId);
    } catch {
      return;
    }
    const nextStatus = task.status === "success" ? "succeeded" : TRIPO_FAILURE_STATUSES.has(task.status) ? task.status === "cancelled" ? "cancelled" : "failed" : "running";
    const nextError = TRIPO_FAILURE_STATUSES.has(task.status) ? task.message || task.error || `Tripo task ${task.status}` : null;
    const nextProgress = task.progress ?? nodeRun.progress;
    const node = run.input?.nodes?.find((candidate) => candidate.id === nodeId) || { type: nodeRun.nodeType, name: nodeRun.nodeName, config: {} };
    const nextOutput = task.status === "success" ? tripoNodeOutput(node, task) : nodeRun.output;
    if (nodeRun.status === nextStatus && nodeRun.error === nextError && nodeRun.progress === nextProgress && JSON.stringify(nodeRun.output) === JSON.stringify(nextOutput)) return;
    nodeRun.status = nextStatus;
    nodeRun.error = nextError;
    nodeRun.output = nextOutput;
    if (nextProgress !== void 0) nodeRun.progress = nextProgress;
    changed = true;
  }));
  if (!changed) return run;
  const statuses = Object.values(run.nodeRuns || {}).map((nodeRun) => nodeRun.status);
  if (statuses.includes("failed")) run.status = "failed";
  else if (statuses.includes("cancelled")) run.status = "cancelled";
  else if (statuses.some((status) => ["queued", "running"].includes(status))) run.status = "running";
  else run.status = "succeeded";
  run.completedAt = ["succeeded", "failed", "cancelled"].includes(run.status) ? (/* @__PURE__ */ new Date()).toISOString() : null;
  return run;
}
var MESHY_FAILURE_STATUSES = /* @__PURE__ */ new Set(["FAILED", "CANCELED"]);
function fillPreviewTask(value, taskId) {
  if (value === MESHY_PREVIEW_TASK) return taskId;
  if (Array.isArray(value)) return value.map((item) => fillPreviewTask(item, taskId));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillPreviewTask(item, taskId)]));
  return value;
}
function refreshRunStatus(run) {
  const statuses = Object.values(run.nodeRuns || {}).map((nodeRun) => nodeRun.status);
  if (statuses.includes("failed")) run.status = "failed";
  else if (statuses.includes("cancelled")) run.status = "cancelled";
  else if (statuses.some((status) => ["queued", "running"].includes(status))) run.status = "running";
  else if (statuses.includes("waiting_review")) run.status = "waiting_review";
  else run.status = "succeeded";
  run.completedAt = ["succeeded", "failed", "cancelled"].includes(run.status) ? (/* @__PURE__ */ new Date()).toISOString() : null;
}
async function syncExecutionWithMeshy(run, { getMeshyTask: getMeshyTask2, submitMeshyTask: submitMeshyTask2 } = {}) {
  if (!run || !getMeshyTask2) return run;
  const open = Object.entries(run.nodeRuns || {}).filter(([, nodeRun]) => nodeRun.meshyHandedOff && nodeRun.meshyTaskId && ["queued", "running"].includes(nodeRun.status));
  if (!open.length) return run;
  let changed = false;
  await Promise.all(open.map(async ([nodeId, nodeRun]) => {
    let task;
    try {
      task = await getMeshyTask2(nodeRun.meshyTaskId, nodeRun.meshyTaskEndpoint);
    } catch {
      return;
    }
    const progress = task.progress ?? nodeRun.progress;
    if (task.status === "SUCCEEDED" && nodeRun.meshyFollowup && !nodeRun.meshyRefined && submitMeshyTask2) {
      try {
        const refineId = await submitMeshyTask2(nodeRun.meshyFollowup.endpoint, fillPreviewTask(nodeRun.meshyFollowup.body, task.id));
        nodeRun.meshyTaskId = refineId;
        nodeRun.meshyTaskEndpoint = nodeRun.meshyFollowup.endpoint;
        nodeRun.meshyFollowup = null;
        nodeRun.meshyRefined = true;
        nodeRun.status = "running";
        nodeRun.progress = Math.max(progress ?? 0, 50);
        changed = true;
      } catch (failure) {
        nodeRun.status = "failed";
        nodeRun.error = failure.message;
        changed = true;
      }
      return;
    }
    const node = run.input?.nodes?.find((candidate) => candidate.id === nodeId) || { type: nodeRun.nodeType, name: nodeRun.nodeName, config: {} };
    if (task.status === "SUCCEEDED") {
      nodeRun.status = "succeeded";
      nodeRun.output = meshyNodeOutput(node, task);
      nodeRun.progress = 100;
      nodeRun.error = null;
      changed = true;
      return;
    }
    if (MESHY_FAILURE_STATUSES.has(task.status)) {
      const reason = task.task_error?.message ? `: ${task.task_error.message}` : "";
      nodeRun.status = task.status === "CANCELED" ? "cancelled" : "failed";
      nodeRun.error = `Meshy task ${task.status}${reason}`;
      if (progress !== void 0) nodeRun.progress = progress;
      changed = true;
      return;
    }
    if (nodeRun.progress !== progress) {
      nodeRun.progress = progress;
      nodeRun.status = "running";
      changed = true;
    }
  }));
  if (changed) refreshRunStatus(run);
  return run;
}
function producedContext(run) {
  const context2 = /* @__PURE__ */ new Map();
  for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns || {})) {
    if (nodeRun.status !== "succeeded" || !nodeRun.output) continue;
    const { modelUrl = null, preview = null, ports = null } = nodeRun.output;
    if (!(modelUrl || preview || ports || nodeRun.meshyTaskId)) continue;
    context2.set(nodeId, { tripoTaskId: nodeRun.tripoTaskId || null, meshyTaskId: nodeRun.meshyTaskId || nodeRun.output?.meshyTaskId || null, modelUrl, preview, ports });
  }
  return context2;
}
async function resumeMeshyExecution(run, canvas, createProvider) {
  if (!run || !createProvider || !canvas || !["queued", "running"].includes(run.status)) return run;
  if (!Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.meshyHandedOff)) return run;
  if (Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.status === "running")) return run;
  const nodes = run.input?.nodes || [];
  const edges = run.input?.edges || [];
  const provider = createProvider({ context: producedContext(run), run, onUpdate: async () => {
  }, canvas });
  const ready = nodes.filter((node) => {
    const nodeRun = run.nodeRuns[node.id];
    if (!nodeRun || nodeRun.status !== "queued") return false;
    const dependencies = edges.filter((edge) => edge.target?.nodeId === node.id).map((edge) => edge.source?.nodeId);
    return dependencies.every((id) => run.nodeRuns[id]?.status === "succeeded");
  });
  if (!ready.length) {
    refreshRunStatus(run);
    return run;
  }
  for (const node of ready) run.nodeRuns[node.id].status = "running";
  await Promise.all(ready.map(async (node) => {
    try {
      const result = await executeNode(node, { nodes, edges }, { provider });
      if (result.status === "running") {
        const nodeRun = run.nodeRuns[node.id];
        nodeRun.status = "running";
        if (result.meshyTaskId) nodeRun.meshyTaskId = result.meshyTaskId;
        if (result.meshyTaskEndpoint) nodeRun.meshyTaskEndpoint = result.meshyTaskEndpoint;
        if (result.meshyFollowup) nodeRun.meshyFollowup = result.meshyFollowup;
        if (result.meshyHandedOff) nodeRun.meshyHandedOff = true;
        if (result.progress !== void 0) nodeRun.progress = result.progress;
        return;
      }
      recordNodeExecution([run], { runId: run.id, canvas, node, result, entryNode: node, mode: run.mode });
    } catch (failure) {
      const activeNodeRun = run.nodeRuns[node.id];
      recordNodeExecution([run], { runId: run.id, canvas, node, entryNode: node, mode: run.mode, result: { status: "failed", durationMs: null, output: null, error: failure.message, ...activeNodeRun?.meshyTaskId ? { meshyTaskId: activeNodeRun.meshyTaskId } : {} } });
    }
  }));
  refreshRunStatus(run);
  return run;
}
function executionById(runs, executionId) {
  return runs.find((run) => run.id === executionId) || null;
}
function executionDto(run) {
  const nodeExecutions = run.nodeRuns || {};
  return {
    id: run.id,
    entryNodeId: run.entryNodeId || Object.keys(run.nodeRuns || {})[0] || null,
    entryNodeName: run.entryNodeName || null,
    canvasId: run.canvasId,
    input: run.input || null,
    parameters: run.parameters || null,
    canvasRevision: run.canvasRevision,
    mode: run.mode || "node",
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    executedNodeCount: Object.values(nodeExecutions).filter((node) => ["succeeded", "failed", "waiting_review"].includes(node.status)).length,
    durationMs: Object.values(nodeExecutions).reduce((total, node) => total + (node.durationMs || 0), 0),
    nodeExecutions
  };
}
function canvasExecutions(runs, canvasId) {
  return runs.filter((run) => run.canvasId === canvasId).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).map(executionDto);
}
function cancelExecution(run) {
  if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) return run;
  run.cancelRequested = true;
  run.status = "cancelling";
  return run;
}
function paginateAssets(assets, url) {
  const requested = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isInteger(requested) ? Math.min(200, Math.max(1, requested)) : 50;
  const cursor = url.searchParams.get("cursor");
  const start = cursor ? Math.max(0, assets.findIndex((asset) => asset.id === cursor) + 1) : 0;
  const items = assets.slice(start, start + limit);
  const hasMore = start + limit < assets.length;
  return { items, nextCursor: hasMore ? items.at(-1)?.id || null : null, hasMore };
}
function refuse(issues) {
  if (!issues.length) return;
  const issue = issues[0];
  const error = new Error(issue.message);
  error.statusCode = 400;
  error.issue = issue;
  throw error;
}
function slotStageOf(canvas) {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]));
  return (nodeId) => byId.get(nodeId)?.generatedAssets?.resultOf?.sourceId || null;
}
function createExecution(runs, canvas, entryNode, mode = "downstream", { nodeIds = null, idempotencyKey = null, parameters = null } = {}) {
  if (!["node", "downstream"].includes(mode)) {
    const error = new Error("Invalid execution mode");
    error.statusCode = 400;
    throw error;
  }
  if (!isExecutableNodeType(entryNode.type)) {
    const error = new Error(`${entryNode.name || entryNode.type} cannot be run on its own`);
    error.statusCode = 400;
    throw error;
  }
  refuse(validateCanvasGraph(canvas.nodes, canvas.edges || []));
  const planCanvas2 = { ...canvas, edges: stagesOnlyEdges(canvas.nodes, canvas.edges || [], isResultNodeType, slotStageOf(canvas)) };
  const executionCanvas = mode === "downstream" ? downstreamCanvas(planCanvas2, entryNode.id) : { ...structuredClone(planCanvas2), nodes: [structuredClone(entryNode)], edges: [] };
  const nodes = executionNodes(executionCanvas);
  const plannedNodeIds = nodes.map((node) => node.id);
  if (nodeIds !== null && (!Array.isArray(nodeIds) || !nodeIds.length || nodeIds.some((nodeId) => typeof nodeId !== "string"))) {
    const error = new Error("nodeIds must be a non-empty array of node IDs");
    error.statusCode = 400;
    throw error;
  }
  if (nodeIds !== null && (nodeIds.length !== plannedNodeIds.length || nodeIds.some((nodeId, index) => nodeId !== plannedNodeIds[index]))) {
    const error = new Error("nodeIds must match the execution plan for entryNodeId and mode");
    error.statusCode = 409;
    throw error;
  }
  if (idempotencyKey !== null && (typeof idempotencyKey !== "string" || !idempotencyKey.trim())) {
    const error = new Error("idempotencyKey must be a non-empty string");
    error.statusCode = 400;
    throw error;
  }
  if (parameters !== null && (typeof parameters !== "object" || Array.isArray(parameters))) {
    const error = new Error("parameters must be an object keyed by node ID");
    error.statusCode = 400;
    throw error;
  }
  for (const [nodeId, config] of Object.entries(parameters || {})) {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !config || typeof config !== "object" || Array.isArray(config)) {
      const error = new Error("parameters must contain object values for planned node IDs");
      error.statusCode = 400;
      throw error;
    }
    node.config = { ...node.config || {}, ...structuredClone(config) };
  }
  const planned = new Map(nodes.map((node) => [node.id, node]));
  refuse(validateCanvasGraph(
    canvas.nodes.map((node) => planned.get(node.id) || node),
    canvas.edges || [],
    { requireParameters: planned.keys() }
  ));
  const executionEntryNode = nodes.find((node) => node.id === entryNode.id) || entryNode;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const run = {
    id: `run-${randomUUID()}`,
    canvasId: canvas.id,
    projectId: canvas.id,
    canvasRevision: canvas.revision,
    entryNodeId: entryNode.id,
    entryNodeType: entryNode.type,
    entryNodeName: entryNode.name || entryNode.type,
    nodeIds: plannedNodeIds,
    ...idempotencyKey ? { idempotencyKey: idempotencyKey.trim() } : {},
    input: { entryNode: structuredClone(executionEntryNode), nodes: structuredClone(nodes), edges: structuredClone(executionCanvas.edges || []) },
    parameters: Object.fromEntries(nodes.map((node) => [node.id, structuredClone(node.config || {})])),
    mode,
    status: "queued",
    cancelRequested: false,
    createdAt: timestamp,
    completedAt: null,
    nodeRuns: Object.fromEntries(nodes.map((node) => [node.id, { status: "queued", nodeType: node.type, nodeName: node.name || node.type, durationMs: null, output: null, error: null }]))
  };
  runs.push(run);
  return { run, executionCanvas, nodes };
}
function slotOutput(slot, output, runId) {
  const origin = { sourceId: slot.generatedAssets.resultOf.sourceId, runId };
  const base = { ...slot.generatedAssets, resultOf: origin };
  const previews = Array.isArray(output.previews) ? output.previews.filter((preview2) => typeof preview2 === "string" && preview2) : [];
  const viewPreviews = output.viewPreviews && typeof output.viewPreviews === "object" ? output.viewPreviews : {};
  const spec = slot.generatedAssets.slot || "";
  if (slot.type === "generated-export") {
    const downloads = Array.isArray(output.outputs) ? output.outputs : output.downloadUrl ? [{ downloadUrl: output.downloadUrl, filename: output.filename, format: output.format }] : [];
    return { ...base, preview: output.preview, modelUrl: output.modelUrl, outputs: downloads };
  }
  if (slot.type === "generated-model") return { ...base, preview: output.preview, modelUrl: output.modelUrl };
  const view = viewPreviews[slot.generatedAssets.view] || (spec.startsWith("view:") ? viewPreviews[spec.slice(5)] : null);
  if (typeof view === "string" && view) return { ...base, preview: view };
  const index = Number(spec.startsWith("image:") ? spec.slice(6) : 0);
  const preview = previews[index] || (index === 0 ? output.preview : null);
  return preview ? { ...base, preview } : base;
}
async function executeExecution(runs, run, canvas, executionCanvas, nodes, entryNode, onUpdate = async () => {
}, { createProvider = null } = {}) {
  run.status = "running";
  await onUpdate();
  const context2 = /* @__PURE__ */ new Map();
  const earlier = latestNodeRuns(canvas, runs.filter((candidate) => candidate.id !== run.id));
  for (const [nodeId, nodeRun] of Object.entries(earlier)) {
    if (nodeRun.status !== "succeeded" || !nodeRun.output) continue;
    const { modelUrl = null, preview = null, ports = null } = nodeRun.output;
    if (modelUrl || preview || ports) context2.set(nodeId, { tripoTaskId: nodeRun.tripoTaskId || null, meshyTaskId: nodeRun.meshyTaskId || nodeRun.output?.meshyTaskId || null, modelUrl, preview, ports });
  }
  const provider = createProvider ? createProvider({ context: context2, run, onUpdate, canvas }) : null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const dependencies = new Map([...nodeIds].map((nodeId) => [nodeId, /* @__PURE__ */ new Set()]));
  const linked = (executionCanvas.edges || []).filter((edge) => nodeIds.has(edge.source?.nodeId) && nodeIds.has(edge.target?.nodeId)).map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId }));
  for (const edge of stagesOnlyEdges(nodes, linked, isResultNodeType, slotStageOf(canvas))) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && dependencies.has(edge.target)) dependencies.get(edge.target).add(edge.source);
  }
  const fillSlots = async () => {
    const slots = (canvas.nodes || []).filter((node) => isResultNodeType(node.type) && node.generatedAssets?.resultOf?.sourceId);
    let changed = false;
    for (const slot of slots) {
      const stageId = slot.generatedAssets.resultOf.sourceId;
      if (!run.nodeRuns[stageId]) continue;
      const nodeRun = run.nodeRuns[stageId];
      if (nodeRun.status !== "succeeded" || !nodeRun.output) continue;
      const next = slotOutput(slot, nodeRun.output, slot.generatedAssets.resultOf.runId || run.id);
      if (!next) continue;
      slot.generatedAssets = next;
      changed = true;
    }
    if (changed) await onUpdate();
  };
  const completed = /* @__PURE__ */ new Set();
  while (completed.size < nodes.length && !run.cancelRequested) {
    const ready = nodes.filter((node) => !completed.has(node.id) && [...dependencies.get(node.id)].every((id) => completed.has(id)));
    if (!ready.length) break;
    for (const node of ready) run.nodeRuns[node.id].status = "running";
    await onUpdate();
    let deferred = false;
    await Promise.all(ready.map(async (node) => {
      try {
        const result = await executeNode(node, executionCanvas, provider ? { provider } : void 0);
        if (result.status === "running") {
          const nodeRun = run.nodeRuns[node.id];
          nodeRun.status = "running";
          if (result.meshyTaskId) nodeRun.meshyTaskId = result.meshyTaskId;
          if (result.meshyTaskEndpoint) nodeRun.meshyTaskEndpoint = result.meshyTaskEndpoint;
          if (result.meshyFollowup) nodeRun.meshyFollowup = result.meshyFollowup;
          if (result.meshyHandedOff) nodeRun.meshyHandedOff = true;
          if (result.progress !== void 0) nodeRun.progress = result.progress;
          deferred = true;
          return;
        }
        if (result.status === "succeeded") context2.set(node.id, { tripoTaskId: result.tripoTaskId || null, meshyTaskId: result.meshyTaskId || null, modelUrl: result.output?.modelUrl || null, preview: result.output?.preview || null, ports: result.output?.ports || null });
        recordNodeExecution(runs, { runId: run.id, canvas, node, result, entryNode, mode: run.mode });
      } catch (failure) {
        const activeNodeRun = run.nodeRuns[node.id];
        recordNodeExecution(runs, { runId: run.id, canvas, node, entryNode, mode: run.mode, result: { status: "failed", durationMs: null, output: null, error: failure.message, ...activeNodeRun?.tripoTaskId ? { tripoTaskId: activeNodeRun.tripoTaskId } : {}, ...activeNodeRun?.progress === void 0 ? {} : { progress: activeNodeRun.progress } } });
      } finally {
        const nodeRun = run.nodeRuns[node.id];
        if (!(nodeRun.status === "running" && nodeRun.meshyHandedOff)) completed.add(node.id);
      }
    }));
    await fillSlots();
    await onUpdate();
    if (deferred) {
      run.status = "running";
      run.completedAt = null;
      await onUpdate();
      return executionDto(run);
    }
    if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === "failed")) break;
  }
  for (const nodeRun of Object.values(run.nodeRuns)) {
    if (nodeRun.status === "queued") nodeRun.status = "skipped";
  }
  if (run.cancelRequested) run.status = "cancelled";
  else if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === "failed")) run.status = "failed";
  else if (Object.values(run.nodeRuns).some((nodeRun) => nodeRun.status === "waiting_review")) run.status = "waiting_review";
  else run.status = "succeeded";
  run.completedAt = (/* @__PURE__ */ new Date()).toISOString();
  await fillSlots();
  await onUpdate();
  return executionDto(run);
}

// server/canvases.ts
function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
function liveWireTies(input) {
  if (!Array.isArray(input.wireTies)) return [];
  const wires = new Set((input.edges || []).map((edge) => `${edge.source?.nodeId}:${edge.source?.port}->${edge.target?.nodeId}:${edge.target?.port}`));
  return input.wireTies.filter((tie) => typeof tie?.id === "string" && Array.isArray(tie.point) && tie.point.length === 2 && Array.isArray(tie.members)).map((tie) => ({ id: tie.id, point: structuredClone(tie.point), members: tie.members.filter((member) => wires.has(member)) })).filter((tie) => tie.members.length);
}
function createCanvas(input) {
  if (!input.name?.trim()) invalid("Canvas name is required");
  const provider = input.provider ?? defaultCanvasProvider;
  if (!["mock", "tripo", "meshy"].includes(provider)) invalid('Canvas provider must be "mock", "tripo", or "meshy"');
  if (!Array.isArray(input.nodes)) invalid("Canvas nodes are invalid");
  if (!input.nodes.every(
    (node) => typeof node.id === "string" && node.id && typeof node.type === "string" && node.type && typeof node.name === "string" && node.name && node.config && typeof node.config === "object" && !Array.isArray(node.config) && Number.isFinite(node.ui?.position?.x) && Number.isFinite(node.ui?.position?.y)
  )) invalid("Canvas nodes are invalid");
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  if (nodeIds.size !== input.nodes.length) invalid("Canvas node IDs must be unique");
  if (input.edges && !Array.isArray(input.edges)) invalid("Canvas edges are invalid");
  if ((input.edges || []).some(
    (edge) => typeof edge.id !== "string" || !edge.id || !nodeIds.has(edge.source?.nodeId) || !nodeIds.has(edge.target?.nodeId) || typeof edge.source?.port !== "string" || typeof edge.target?.port !== "string"
  )) invalid("Canvas edges must connect nodes inside the canvas");
  const graphIssues = validateCanvasGraph(input.nodes, input.edges || []);
  if (graphIssues.length) invalid(graphIssues[0].message);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    schemaVersion: "1.0",
    id: `canvas-${randomUUID()}`,
    name: input.name.trim(),
    description: input.description?.trim() || "",
    provider,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    nodes: structuredClone(input.nodes),
    edges: structuredClone(input.edges || []),
    ...liveWireTies(input).length ? { wireTies: liveWireTies(input) } : {},
    viewport: input.viewport && typeof input.viewport === "object" ? structuredClone(input.viewport) : { x: 0, y: 0, zoom: 1 },
    ...input.ownerId ? { ownerId: input.ownerId } : {}
  };
}
function duplicateCanvas(source) {
  const nodeIds = new Map(source.nodes.map((node) => [node.id, `${node.id}-${randomUUID()}`]));
  return createCanvas({
    ...source,
    name: `${source.name} Copy`,
    nodes: source.nodes.map((node) => ({
      ...structuredClone(node),
      id: nodeIds.get(node.id),
      ui: {
        ...structuredClone(node.ui),
        ...node.ui.parentFrameId ? { parentFrameId: nodeIds.get(node.ui.parentFrameId) } : {}
      }
    })),
    edges: source.edges.map((edge) => ({
      ...structuredClone(edge),
      id: `${edge.id || "edge"}-${randomUUID()}`,
      source: { ...edge.source, nodeId: nodeIds.get(edge.source.nodeId) },
      target: { ...edge.target, nodeId: nodeIds.get(edge.target.nodeId) }
    })),
    // A wire's name carries node ids, so a duplicate rewrites them.
    wireTies: (source.wireTies || []).map((tie) => ({
      ...structuredClone(tie),
      members: tie.members.map((member) => {
        const match = /^(.*?):(.*?)->(.*?):(.*)$/.exec(member);
        return match ? `${nodeIds.get(match[1]) || match[1]}:${match[2]}->${nodeIds.get(match[3]) || match[3]}:${match[4]}` : member;
      })
    }))
  });
}
function createSession(canvas) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: `session-${randomUUID()}`,
    canvasId: canvas.id,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}
function createInitialSession(canvas) {
  const now = canvas.createdAt;
  return {
    id: `session-${randomUUID()}`,
    canvasId: canvas.id,
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: `msg-${randomUUID()}`,
      role: "assistant",
      content: "This project is ready. Describe what you want to create or edit on its canvas.",
      createdAt: now
    }]
  };
}

// server/canvas-parameters.ts
function parameterKind(parameter) {
  if (parameter.control === "toggle") return "boolean";
  if (parameter.control === "slider") return "number";
  if (parameter.control === "text" || parameter.control === "textarea") return "string";
  return "enum";
}
var canvasParameters = Object.fromEntries(canvasNodeSchema.filter((node) => node.parameters.length).map((node) => [node.type, {
  label: node.label,
  fields: Object.fromEntries(allParameters(node.parameters).flatMap((parameter) => {
    const range = parameterRange(parameter, node.defaults);
    return [[parameter.key, {
      label: parameter.label,
      kind: parameterKind(parameter),
      ...parameter.options && parameter.control !== "toggle" ? { values: parameter.options.map((option) => option.value) } : {},
      ...range ? range : {}
    }]];
  }).filter(([key], index, entries) => entries.findIndex((entry) => entry[0] === key) === index))
}]));
function fieldJsonSchema(field) {
  if (field.kind === "enum") {
    const types = [...new Set(field.values.map((value) => typeof value))];
    return { type: types.length === 1 ? types[0] : types, enum: field.values };
  }
  if (field.kind === "boolean") return { type: "boolean" };
  if (field.kind === "string") return { type: "string" };
  return { type: "number", minimum: field.min, maximum: field.max, multipleOf: field.step };
}
function canvasParameterJsonSchema() {
  const fields = /* @__PURE__ */ new Map();
  for (const definition of Object.values(canvasParameters)) {
    for (const [name, field] of Object.entries(definition.fields)) {
      const existing = fields.get(name);
      if (!existing) {
        fields.set(name, { ...fieldJsonSchema(field), description: field.label });
      } else if (existing.enum && field.kind === "enum") {
        existing.enum = [.../* @__PURE__ */ new Set([...existing.enum, ...field.values])];
      }
    }
  }
  return {
    type: "object",
    description: "Include every parameter explicitly requested for this node, using these canonical property names.",
    properties: Object.fromEntries(fields),
    additionalProperties: false
  };
}
function fieldDescription(field) {
  if (field.kind === "enum") return `${field.label} (${field.values.join(", ")})`;
  if (field.kind === "boolean") return `${field.label} (on/off)`;
  if (field.kind === "string") return field.label;
  return `${field.label} (${field.min.toLocaleString()}-${field.max.toLocaleString()})`;
}
function describeCanvasParameters(canvas, requestedType) {
  const entries = Object.entries(canvasParameters).filter(
    ([type]) => canvas.nodes.some((node) => node.type === type) && (!requestedType || type === requestedType)
  );
  return entries.map(
    ([, definition]) => `${definition.label}: ${Object.values(definition.fields).map(fieldDescription).join(", ")}`
  ).join("\n");
}
function updateNodeParameters(canvas, nodeId, parameters) {
  const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" was not found.`);
  const schema = nodeSchema(node.type, canvas.provider || defaultCanvasProvider);
  if (!schema?.parameters.length) throw new Error(`${node.name} has no adjustable parameters.`);
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("Parameters must be an object.");
  const changes = [];
  for (const [inputField, input] of Object.entries(parameters)) {
    const normalizedField = inputField.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    const parameter = allParameters(schema.parameters).find(
      (candidate) => candidate.key.toLowerCase() === normalizedField || candidate.label.toLowerCase().replaceAll(/[^a-z0-9]/g, "") === normalizedField
    );
    if (!parameter) throw new Error(`${schema.label} does not support parameter "${inputField}".`);
    const kind = parameterKind(parameter);
    let value = input;
    if (kind === "number") {
      value = Number(input);
      const range = parameterRange(parameter, { ...node.config, [parameter.key]: value });
      if (!Number.isFinite(value) || value < range.min || value > range.max || value % range.step !== 0) {
        throw new Error(`${parameter.label} must be ${range.min}-${range.max} in steps of ${range.step}.`);
      }
    } else if (kind === "boolean") {
      if (typeof input !== "boolean") throw new Error(`${parameter.label} must be true or false.`);
    } else if (kind === "string") {
      if (typeof input !== "string") throw new Error(`${parameter.label} must be text.`);
    } else {
      value = parameter.options.find((option) => String(option.value).toLowerCase() === String(input).toLowerCase())?.value;
      if (value === void 0) throw new Error(`${parameter.label} must be one of: ${parameter.options.map((option) => option.value).join(", ")}.`);
    }
    if (node.config[parameter.key] === value) continue;
    changes.push({ nodeId, nodeLabel: schema.label, fieldLabel: parameter.label, previousValue: node.config[parameter.key], value });
    node.config = applyNodeParameter(node.type, node.config, parameter.key, value, canvas.provider || defaultCanvasProvider);
  }
  return changes;
}

// server/planner.ts
var nodeDefaults2 = Object.fromEntries(canvasNodeSchema.filter((node) => node.role !== "container" && node.role !== "result").map((node) => [node.type, { name: node.label, config: nodeDefaults(node.type) }]));
function frameName(message) {
  if (/blahaj|鲨鱼/i.test(message)) return "Blahaj 3D Reconstruction";
  return "3D Asset Reconstruction";
}
function createFrame(message, nodes = []) {
  return {
    id: slug("frame-main", nodes),
    type: "frame",
    name: frameName(message),
    config: {},
    ui: { position: { x: 40, y: 80 }, size: { width: 1640, height: 650 } }
  };
}
function slug(type, nodes) {
  let id = type;
  let index = 2;
  while (nodes.some((node) => node.id === id)) id = `${type}-${index++}`;
  return id;
}
function createNode(type, nodes) {
  const id = slug(type, nodes);
  const previous = nodes.filter((node) => node.type !== "frame").at(-1);
  const frame2 = nodes.find((node) => node.type === "frame");
  return {
    id,
    type,
    name: nodeDefaults2[type].name,
    config: structuredClone(nodeDefaults2[type].config),
    ui: { position: { x: previous ? previous.ui.position.x + 340 : 100, y: previous?.ui.position.y ?? 150 }, ...frame2 ? { parentFrameId: frame2.id } : {} }
  };
}
function fitFrame(nodes, options2 = {}) {
  const padding = options2.padding ?? 70;
  const nodeWidth = options2.nodeWidth ?? 260;
  const nodeHeight = options2.nodeHeight ?? 430;
  for (const frame2 of nodes.filter((node) => node.type === "frame")) {
    const children = nodes.filter((node) => node.ui.parentFrameId === frame2.id);
    if (!children.length) continue;
    const minX = Math.min(...children.map((node) => node.ui.position.x));
    const minY = Math.min(...children.map((node) => node.ui.position.y));
    const maxX = Math.max(...children.map((node) => node.ui.position.x + nodeWidth));
    const maxY = Math.max(...children.map((node) => node.ui.position.y + nodeHeight));
    frame2.ui.size = { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
    for (const child of children) {
      child.ui.position.x += padding - minX;
      child.ui.position.y += padding - minY;
    }
  }
  return nodes;
}
function rebuildDagEdges(nodes) {
  const byType = new Map(nodes.map((node) => [node.type, node]));
  const edges = [];
  const GENERIC_PORTS = /* @__PURE__ */ new Set(["image", "model", "text"]);
  const connect = (sourceType, targetType, ports = {}) => {
    const source = byType.get(sourceType);
    const target = byType.get(targetType);
    if (!source || !target) return;
    const usedTargetPorts = new Set(edges.filter((edge) => edge.target.nodeId === target.id).map((edge) => edge.target.port));
    for (const sourcePort of nodeOutputPorts(sourceType)) {
      if (ports.from && sourcePort.id !== ports.from) continue;
      const inputs = nodeInputPorts(targetType).filter((candidate) => !usedTargetPorts.has(candidate.id));
      const targetPort = ports.to ? inputs.find((candidate) => candidate.id === ports.to) : inputs.find((candidate) => candidate.id === sourcePort.id) || inputs.find((candidate) => GENERIC_PORTS.has(candidate.id) && (sourcePort.type === "any" || candidate.type === sourcePort.type || candidate.type === "any"));
      if (!targetPort) continue;
      usedTargetPorts.add(targetPort.id);
      edges.push({
        id: `${source.id}-${sourcePort.id}-${target.id}-${targetPort.id}`,
        source: { nodeId: source.id, port: sourcePort.id },
        target: { nodeId: target.id, port: targetPort.id }
      });
    }
  };
  connect("reference-image", "generate-image");
  connect("prompt", "generate-image");
  connect("generate-image", "image-to-image");
  connect("text-to-image", "image-to-image");
  connect("reference-image", "image-decomposition");
  connect("image-decomposition", "generate-image");
  connect("prompt", "text-to-image");
  if (byType.has("review")) {
    connect("generate-image", "review");
    connect("review", "generate-model", { from: "image", to: "image" });
  } else {
    connect("generate-image", "generate-model");
  }
  connect("reference-image", "generate-multiview-images");
  connect("prompt", "generate-multiview-images");
  connect("prompt", "text-to-3d");
  connect("prompt", "text-to-motion");
  connect("generate-image", "smart-mesh");
  connect("prompt", "smart-mesh");
  connect("reference-image", "creative-lab");
  connect("generate-image", "creative-lab");
  connect("generate-multiview-images", "multiview-to-3d");
  connect("generate-multiview-images", "generate-model");
  connect("generate-multiview-images", "smart-mesh");
  if (!byType.has("generate-image") && !byType.has("generate-multiview-images")) {
    connect("reference-image", "generate-model");
    connect("reference-image", "smart-mesh");
    connect("prompt", "generate-model");
  }
  const modelSource = byType.has("text-to-3d") ? "text-to-3d" : byType.has("multiview-to-3d") ? "multiview-to-3d" : byType.has("smart-mesh") ? "smart-mesh" : byType.has("creative-lab") ? "creative-lab" : "generate-model";
  const MESH_STAGES = [
    "retopology",
    "remesh",
    "uv-unwrap",
    "texture",
    "retexture",
    "rigging",
    "animation",
    "segments",
    "resize-model",
    "print-analyze",
    "print-repair",
    "auto-split",
    "multi-color-print",
    "convert-model"
  ];
  connect("text-to-motion", "animation", { from: "model", to: "motion" });
  const modelChain = [modelSource, ...MESH_STAGES.filter((type) => byType.has(type))];
  modelChain.slice(1).forEach((type, index) => connect(modelChain[index], type));
  const finalModelType = modelChain.at(-1);
  const finalNodeType = byType.has("export-model") ? "export-model" : "model-preview";
  connect(finalModelType, finalNodeType);
  return edges;
}
function buildCanvasStructure(message, types, existingCanvas = null, options2 = {}) {
  const normalizedTypes = [...new Set(types)].filter((type) => nodeDefaults2[type]);
  if (!normalizedTypes.length) return existingCanvas ? structuredClone(existingCanvas) : baseCanvas(message);
  const existingNodes = existingCanvas ? structuredClone(existingCanvas.nodes) : [];
  const sectionNodes = [createFrame(message, existingNodes)];
  for (const type of normalizedTypes) {
    const node = createNode(type, sectionNodes);
    node.id = slug(type, [...existingNodes, ...sectionNodes]);
    sectionNodes.push(node);
  }
  fitFrame(sectionNodes);
  if (existingNodes.length) {
    const topLevelNodes = existingNodes.filter((node) => !node.ui.parentFrameId);
    if (topLevelNodes.length) {
      const right = Math.max(...topLevelNodes.map((node) => node.ui.position.x + (node.ui.size?.width ?? 260)));
      sectionNodes[0].ui.position = {
        x: right + 160,
        y: Math.min(...topLevelNodes.map((node) => node.ui.position.y))
      };
    }
  }
  const nodes = [...existingNodes, ...sectionNodes];
  const edges = [
    ...existingCanvas ? structuredClone(existingCanvas.edges) : [],
    ...rebuildDagEdges(sectionNodes)
  ];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const canvas = existingCanvas ? structuredClone(existingCanvas) : {
    schemaVersion: "1.0",
    id: `canvas-${randomUUID()}`,
    revision: 0,
    createdAt: now
  };
  const textTo3d = normalizedTypes.includes("text-to-3d");
  const next = {
    ...canvas,
    name: existingCanvas?.name || (textTo3d ? "Text to 3D Pipeline" : "3D Asset Pipeline"),
    description: existingCanvas?.description || "A reusable 3D production canvas created through conversation.",
    revision: existingCanvas ? existingCanvas.revision + 1 : 1,
    updatedAt: now,
    nodes,
    edges,
    viewport: existingCanvas?.viewport || { x: 80, y: 160, zoom: 0.72 }
  };
  const configs = options2?.configs || {};
  const created = new Map(sectionNodes.filter((node) => node.type !== "frame").map((node) => [node.type, node]));
  for (const [type, config] of Object.entries(configs)) {
    if (!config || typeof config !== "object") continue;
    const node = created.get(type);
    if (!node) {
      throw new Error(`configs mentions "${type}", which is not part of this build (${normalizedTypes.join(", ")})`);
    }
    try {
      updateNodeParameters(next, node.id, config);
    } catch (error) {
      throw new Error(`${type}: ${error.message}`);
    }
  }
  return next;
}
var PREVIEW_TYPES = new Set(canvasNodeSchema.filter((node) => node.role === "result").map((node) => node.type));
function wireKeyOf(edge) {
  return `${edge.source.nodeId}:${edge.source.port}->${edge.target.nodeId}:${edge.target.port}`;
}
var COLUMN_GAP2 = 340;
function compactFrames(nodes, options2 = {}) {
  if (options2.compact === false) return;
  for (const frame2 of nodes.filter((node) => node.type === "frame")) {
    const children = nodes.filter((node) => node.ui?.parentFrameId === frame2.id);
    if (!children.length) continue;
    const ordered = [...children].sort((left, right) => left.ui.position.x - right.ui.position.x);
    const baseline = ordered[0].ui.position.y;
    const singleRow = ordered.every((node) => Math.abs(node.ui.position.y - baseline) < 80);
    if (singleRow) {
      ordered.forEach((node, index) => {
        node.ui.position.x = ordered[0].ui.position.x + index * COLUMN_GAP2;
        node.ui.position.y = baseline;
      });
    }
    const minX = Math.min(...ordered.map((node) => node.ui.position.x));
    const minY = Math.min(...ordered.map((node) => node.ui.position.y));
    const maxX = Math.max(...ordered.map((node) => node.ui.position.x + (node.ui.size?.width ?? 260)));
    const maxY = Math.max(...ordered.map((node) => node.ui.position.y + (node.ui.size?.height ?? 430)));
    frame2.ui.size = { width: maxX - minX + 140, height: maxY - minY + 140 };
  }
}
function removeCanvasNodes(canvas, nodeIds, options2 = {}) {
  const next = structuredClone(canvas);
  const doomed = new Set((nodeIds || []).filter((id) => typeof id === "string"));
  const gone = next.nodes.filter((node) => doomed.has(node.id));
  if (!gone.length) return { canvas: next, removed: [], bridged: [], changed: false };
  const removedIds = new Set(gone.map((node) => node.id));
  const removed = gone.map((node) => ({ id: node.id, type: node.type, name: node.name }));
  const incoming = next.edges.filter((edge) => removedIds.has(edge.target.nodeId) && !removedIds.has(edge.source.nodeId));
  const outgoing = [];
  const walkDownstream = (edge) => {
    if (!removedIds.has(edge.target.nodeId)) {
      outgoing.push(edge);
      return;
    }
    for (const deeper of next.edges.filter((candidate) => candidate.source.nodeId === edge.target.nodeId)) walkDownstream(deeper);
  };
  for (const edge of next.edges.filter((candidate) => removedIds.has(candidate.source.nodeId))) walkDownstream(edge);
  next.nodes = next.nodes.filter((node) => !removedIds.has(node.id));
  next.edges = next.edges.filter((edge) => !removedIds.has(edge.source.nodeId) && !removedIds.has(edge.target.nodeId));
  const bridged = [];
  for (const inEdge of incoming) {
    for (const outEdge of outgoing) {
      const source = next.nodes.find((node) => node.id === inEdge.source.nodeId);
      const target = next.nodes.find((node) => node.id === outEdge.target.nodeId);
      if (!source || !target) continue;
      const sourcePort = nodeOutputPorts(source.type).find((port) => port.id === inEdge.source.port);
      if (!sourcePort) continue;
      const used = new Set(next.edges.filter((edge) => edge.target.nodeId === target.id).map((edge) => edge.target.port));
      const targetPort = nodeInputPorts(target.type).find((port) => port.id === outEdge.target.port && !used.has(port.id)) || nodeInputPorts(target.type).find((port) => !used.has(port.id) && ["image", "model", "text"].includes(port.id) && (port.type === sourcePort.type || port.type === "any" || sourcePort.type === "any"));
      if (!targetPort) continue;
      if (sourcePort.type !== "any" && targetPort.type !== "any" && sourcePort.type !== targetPort.type) continue;
      if (next.edges.some((edge) => edge.source.nodeId === source.id && edge.target.nodeId === target.id && edge.target.port === targetPort.id)) continue;
      let id = `edge-${source.id}-${target.id}`;
      let suffix = 2;
      while (next.edges.some((edge) => edge.id === id)) id = `edge-${source.id}-${target.id}-${suffix++}`;
      next.edges.push({ id, source: { nodeId: source.id, port: sourcePort.id }, target: { nodeId: target.id, port: targetPort.id } });
      bridged.push({ from: source.id, to: target.id });
    }
  }
  if (Array.isArray(next.wireTies)) {
    const live = new Set(next.edges.map(wireKeyOf));
    next.wireTies = next.wireTies.map((tie) => ({ ...tie, members: (tie.members || []).filter((member) => live.has(member)) })).filter((tie) => tie.members.length > 0);
  }
  compactFrames(next.nodes, options2);
  next.revision = (canvas.revision || 0) + 1;
  next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return { canvas: next, removed, bridged, changed: true };
}
function baseCanvas(message) {
  const lower = message.toLowerCase();
  const name = lower.includes("prop") || message.includes("\u9053\u5177") ? "Game Prop Pipeline" : "3D Asset Pipeline";
  const textTo3d = /text[ -]?to[ -]?3d|generate (?:a )?(?:3d )?model from (?:text|a prompt|a description)|文生3d|文字生成3d|文本生成3d|提示词生成3d|根据描述生成3d/i.test(message);
  const types = textTo3d ? ["prompt", "text-to-3d", "export-model"] : ["reference-image", "prompt", "generate-image", "generate-model", "export-model"];
  const nodes = [createFrame(message)];
  for (const type of types) nodes.push(createNode(type, nodes));
  fitFrame(nodes);
  return {
    schemaVersion: "1.0",
    id: `canvas-${randomUUID()}`,
    name,
    description: "A reusable 3D production canvas created through conversation.",
    revision: 1,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    nodes,
    edges: rebuildDagEdges(nodes),
    viewport: { x: 80, y: 160, zoom: 0.72 }
  };
}
function insertBefore(canvas, type, beforeTypes) {
  if (canvas.nodes.some((node2) => node2.type === type)) return false;
  const node = createNode(type, canvas.nodes);
  const index = canvas.nodes.findIndex((candidate) => beforeTypes.includes(candidate.type));
  canvas.nodes.splice(index < 0 ? canvas.nodes.length : index, 0, node);
  return true;
}
function addCanvasStage(canvas, type, message = "") {
  const nextCanvas = structuredClone(canvas);
  const allowedTypes = /* @__PURE__ */ new Set(["frame", ...Object.keys(nodeDefaults2)]);
  if (!allowedTypes.has(type)) throw new Error(`Unsupported canvas node type: ${type}`);
  const changedNodeIds = [];
  if (type === "frame") {
    const frame2 = createFrame(message, nextCanvas.nodes);
    nextCanvas.nodes.push(frame2);
    changedNodeIds.push(frame2.id);
  } else if (insertBefore(nextCanvas, type, type === "review" ? ["generate-model", "multiview-to-3d"] : ["export-model", "model-preview"])) {
    changedNodeIds.push(nextCanvas.nodes.find((node) => node.type === type).id);
  }
  if (!changedNodeIds.length) {
    return { canvas: nextCanvas, changedNodeIds, structureChanged: false };
  }
  nextCanvas.edges = rebuildDagEdges(nextCanvas.nodes);
  fitFrame(nextCanvas.nodes);
  nextCanvas.revision += 1;
  nextCanvas.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return { canvas: nextCanvas, changedNodeIds, structureChanged: true };
}

// server/canvas-tools.ts
var canvasNodeTypes = canvasNodeSchema.filter((node) => node.role !== "container" && node.role !== "result").map((node) => node.type);
var canvasToolDefinitions = [
  {
    name: "get_canvas_structure",
    description: "Inspect every node and connection on the current canvas, across all canvas sections.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "list_available_node_types",
    description: "List every node type that can be created in a canvas.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_credit_balance",
    description: "Read the current user name, credit balance, and fixed cost of one execution. This tool cannot change credits.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "build_canvas",
    description: "Append a canvas section from an ordered list of node types without replacing existing canvas content. All new nodes are placed inside one frame and compatible nodes are connected automatically.",
    parameters: {
      type: "object",
      properties: {
        nodeTypes: {
          type: "array",
          description: "Complete ordered node type list. Do not include frame; it is created automatically.",
          items: { type: "string", enum: canvasNodeTypes },
          minItems: 1
        }
      },
      required: ["nodeTypes"],
      additionalProperties: false
    }
  },
  {
    name: "get_canvas_parameters",
    description: "List all nodes on the current canvas and their adjustable parameters, valid ranges, and options.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "update_node_parameters",
    description: "Update validated parameters on one existing canvas node. You must use the exact nodeId returned by get_canvas_structure; do not use a display name or node type.",
    parameters: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Exact ID of a node on the current canvas." },
        parameters: canvasParameterJsonSchema()
      },
      required: ["nodeId", "parameters"],
      additionalProperties: false
    }
  },
  {
    name: "add_canvas_node",
    description: "Add one canvas node of the requested type when that node type does not already exist. Frame can also be added as a separate canvas container.",
    parameters: {
      type: "object",
      properties: { type: { type: "string", enum: ["frame", ...canvasNodeTypes] } },
      required: ["type"],
      additionalProperties: false
    }
  },
  {
    name: "request_user_select",
    description: "Pause the turn and ask the user to select one or more options before continuing.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1 },
        options: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1 },
              label: { type: "string", minLength: 1 }
            },
            required: ["id", "label"],
            additionalProperties: false
          }
        },
        min: { type: "integer", minimum: 1 },
        max: { type: "integer", minimum: 1 }
      },
      required: ["prompt", "options", "min", "max"],
      additionalProperties: false
    }
  },
  {
    name: "execute_canvas_node",
    description: "Request an independent paid background execution for an executable node on the current canvas. Multiple requests can run concurrently. The host validates the node, checks the balance, charges the fixed execution cost, and runs it through the normal execution API.",
    parameters: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Exact executable node ID returned by get_canvas_structure." },
        mode: { type: "string", enum: ["node", "downstream"] }
      },
      required: ["nodeId", "mode"],
      additionalProperties: false
    }
  },
  {
    name: "list_canvas_executions",
    description: "List recent and active background executions for the current canvas, including task IDs, node names, status, and progress.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_execution_status",
    description: "Read the latest status and per-node progress of one background execution on the current canvas.",
    parameters: {
      type: "object",
      properties: { executionId: { type: "string", description: "Exact task ID returned by execute_canvas_node or list_canvas_executions." } },
      required: ["executionId"],
      additionalProperties: false
    }
  },
  {
    name: "cancel_execution",
    description: "Request cancellation of one queued or running background execution on the current canvas.",
    parameters: {
      type: "object",
      properties: { executionId: { type: "string", description: "Exact task ID returned by execute_canvas_node or list_canvas_executions." } },
      required: ["executionId"],
      additionalProperties: false
    }
  }
];

// server/deepseek.ts
var nodeCatalogRows = [
  ["reference-image", "Upload or reference a single source image.", "none", "image"],
  ["prompt", "A text description / creative direction.", "none", "text"],
  ["generate-image", "Generate concept image candidates from a reference image and/or text.", "image, text", "image(s)"],
  ["generate-multiview-images", "Generate several views (front/back/left/right) of the SAME subject from one reference image and/or text.", "image, text", "multiple view images"],
  ["generate-model", "Reconstruct a 3D model from text, one image, or multiple images. It automatically detects how many images the upstream stage outputs.", "image(s), text", "3D model"],
  ["smart-mesh", "Generate a mesh directly from a single image and/or text.", "image, text", "3D model"],
  ["text-to-3d", "Reconstruct a 3D model from text only.", "text", "3D model"],
  ["multiview-to-3d", "Reconstruct a 3D model from labeled front, back, left, and right images.", "front, back, left, right images", "3D model"],
  ["text-to-image", "Meshy text-to-image. Multi-view returns front, side, and back images.", "text", "image(s)"],
  ["image-to-image", "Edit a reference image with a Meshy prompt.", "image, text", "image(s)"],
  ["remesh", "Retopologize a model.", "3D model", "3D model"],
  ["retexture", "Paint a new texture from text or a style image.", "3D model, optional image or text", "3D model"],
  ["animation", "Apply a library animation, or a text-to-motion clip, to a Meshy rig.", "rigged 3D model, optional motion", "3D model"],
  ["text-to-motion", "Generate a motion clip from a description.", "text", "motion"],
  ["convert-model", "Convert a model to GLB, FBX, OBJ, USDZ, BLEND, STL, or 3MF.", "3D model", "3D model"],
  ["resize-model", "Scale a model to a real-world size.", "3D model", "3D model"],
  ["uv-unwrap", "Build a clean UV layout for a GLB.", "3D model", "3D model"],
  ["print-analyze", "Check a model for FDM printability.", "3D model", "3D model"],
  ["print-repair", "Repair a mesh for FDM printing.", "3D model", "3D model"],
  ["multi-color-print", "Export a multi-color 3MF for a slicer.", "3D model", "3D model"],
  ["auto-split", "Split a Meshy 6 or 7 model into printable parts.", "3D model, optional text", "3D model"],
  ["creative-lab", "Turn a photo into a printable product such as a keychain, magnet, figure, lamp, keycap, or fidget.", "image", "3D model"],
  ["review", "Manual checkpoint to approve an image before continuing.", "image", "image"],
  ["retopology", "Optimize / clean up model geometry.", "3D model", "3D model"],
  ["texture", "Generate UV textures for a model (optionally guided by an image or text).", "3D model (+ optional image/text)", "3D model"],
  ["rigging", "Add a skeleton / rig to a model.", "3D model", "3D model"],
  ["segments", "Segment a model into separate parts.", "3D model", "3D model"],
  ["model-preview", "Interactive 3D preview of the result.", "3D model", "3D model"],
  ["export-model", "Export the final image or 3D model. Terminal stage.", "image or 3D model", "none"]
];
var nodeCatalogText = nodeCatalogRows.map(([type, summary, input, output]) => `- ${type}: ${summary} Input: ${input}. Output: ${output}.`).join("\n");
var systemPrompt = `You are the builder agent for a 3D production canvas canvas. You can build canvas structures and adjust node parameters. Use tools for every canvas change; never claim a change unless a tool succeeded.

Node catalog (each node type, what it does, and the media it takes/produces). A node can only receive what a previous node produces:
${nodeCatalogText}

Choose node types by matching outputs to inputs. generate-model is the unified 3D generation node: it accepts text, a single image, or multiple images and automatically selects single-image or multi-image reconstruction from its upstream input. There are two distinct ways to feed several images into a 3D model, and they use different nodes:

1. Generate the missing views from ONE image: reference-image \u2192 generate-multiview-images \u2192 generate-model. Use generate-multiview-images only when the user has a single reference and wants you to CREATE front/back/left/right views from it.

2. Use SEVERAL existing images directly: reference-image \u2192 generate-model. When the user already has multiple images of the subject (different angles already available), feed them straight into generate-model and do NOT add generate-multiview-images, because those views already exist. When those images are already labeled front, back, left, and right, use one reference-image per view wired into multiview-to-3d instead.

Meshy canvases can also use text-to-image, image-to-image, remesh, retexture, rigging, animation, text-to-motion, convert-model, resize-model, uv-unwrap, print-analyze, print-repair, multi-color-print, auto-split, and creative-lab. Animation needs an upstream rigging node. text-to-motion feeds animation's motion input.

When a multi-image request is ambiguous \u2014 you cannot tell whether the user has one image (and wants the views generated) or already has several images \u2014 do NOT guess. Call request_user_select with one option per path above, so the user confirms which one.

When the user asks to create, build, or design a canvas, call build_canvas with the complete ordered nodeTypes list. The server appends one new frame without replacing existing canvas content, places all new nodes inside it, connects compatible ports, and lays out the new section. Common shapes: text-to-image-to-3D = reference-image, prompt, generate-image, generate-model, export-model; direct text-to-3D = prompt, text-to-3d, export-model; one image generating multi-view then 3D = reference-image, generate-multiview-images, generate-model, export-model; several existing images to 3D = reference-image, generate-model, export-model. Add retopology, texture, rigging, and segments before export-model when requested.

Use get_canvas_structure when the current nodes or connections are unclear. Use list_available_node_types when the creatable node types are unclear. Use get_credit_balance when the user asks about their credits or before a paid execution if the balance is unclear. Use execute_canvas_node only when the user explicitly asks to run, generate, regenerate, retry, or export; every call requests an independent background execution, and several executions may run concurrently. Use list_canvas_executions when the user asks about recent or active tasks without supplying a task ID. Use get_execution_status for the latest progress of a specific task. Use cancel_execution only when the user explicitly asks to stop a task. Use add_canvas_node to add any supported node type, including frame, when it is not already present; use build_canvas to append a complete canvas section. Use get_canvas_parameters when parameter names, node IDs, ranges, or options are unclear. Apply every parameter explicitly requested by the user. Group all requested changes for the same node into one update_node_parameters call, use separate calls for different nodes, and verify every requested change appears in successful tool results before replying. When you need the user to choose from a finite set of valid alternatives before continuing, you MUST call request_user_select. Never ask that question, list the options, or tell the user to choose in normal assistant text. For an empty canvas, if the user has not stated how to create the model, call request_user_select with the available canvas approaches. Do not ask for free-form text with this tool.

Format every normal assistant reply as readable Markdown, especially when describing a multi-step workflow, parameter changes, execution status, or alternatives. Prefer a short heading followed by structured sections such as **Summary**, **Nodes**, **Connections**, **Parameters**, **Execution**, and **Next steps**. Use bullet or numbered lists for items and steps, backticks for node types, node IDs, parameters, and values, and Markdown tables when comparing several nodes or options with consistent fields. Use bold only for important labels or conclusions. Keep the response concise, do not repeat the entire canvas, and do not put the response inside a code block. For a user-selection checkpoint, use the selection tool and let the UI render the choices; do not duplicate the choices in normal assistant text. Reply in the user's language and summarize the nodes and connections actually created or changed.`;
var progressLabelByTool = {
  get_canvas_structure: "Inspecting canvas structure",
  list_available_node_types: "Listing available node types",
  get_credit_balance: "Checking credit balance",
  get_canvas_parameters: "Inspecting adjustable parameters",
  build_canvas: "Building canvas",
  update_node_parameters: "Updating node parameters",
  add_canvas_node: "Adding canvas node",
  request_user_select: "Waiting for your selection",
  execute_canvas_node: "Requesting node execution",
  list_canvas_executions: "Listing canvas tasks",
  get_execution_status: "Checking task progress",
  cancel_execution: "Requesting task cancellation"
};
var tools = canvasToolDefinitions.map((definition) => ({ type: "function", function: definition }));
var DeepSeekError = class extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
};
function parseArguments(call) {
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    throw new DeepSeekError("DeepSeek returned invalid tool arguments.");
  }
}
async function runDeepSeekAgent({ apiKey, message, canvas, account, executions = [], history = [], fetchImpl = fetch, baseUrl = "https://api.deepseek.com", model = "deepseek-v4-flash", maxRounds = 5, signal, onProgress = () => {
}, onTrace = () => {
}, onCheckpoint = () => {
}, checkpoint }) {
  if (!apiKey) throw new DeepSeekError("DeepSeek is not configured.", 503);
  baseUrl ||= "https://api.deepseek.com";
  model ||= "deepseek-v4-flash";
  let nextCanvas = structuredClone(checkpoint?.canvas || canvas);
  let structureChanged = Boolean(checkpoint?.structureChanged);
  const changes = structuredClone(checkpoint?.changes || []);
  const executionRequests = structuredClone(checkpoint?.executionRequests || []);
  const cancellationRequests = structuredClone(checkpoint?.cancellationRequests || []);
  const messages = checkpoint?.messages ? structuredClone(checkpoint.messages) : [
    { role: "system", content: systemPrompt },
    ...history.slice(-20).map(({ role, content }) => ({ role, content })),
    { role: "user", content: message }
  ];
  if (checkpoint?.phase === "waiting_for_user") messages.push({ role: "user", content: message });
  for (let round = checkpoint?.round || 0; round < maxRounds; round += 1) {
    await onProgress({ label: round ? "Reviewing canvas changes" : "Reviewing your request", status: "running" });
    let response;
    const requestStartedAt = Date.now();
    await onTrace({ type: "model_request_started", payload: { round, model, messageCount: messages.length } });
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, messages, tools, tool_choice: "auto", stream: false }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3e4)]) : AbortSignal.timeout(3e4)
      });
    } catch (error) {
      await onTrace({ type: "model_request_failed", payload: { round, durationMs: Date.now() - requestStartedAt, error: { name: error?.name || "Error", message: error?.message || String(error) } } });
      if (signal?.aborted) throw error;
      throw new DeepSeekError("The DeepSeek service is unavailable.", 503);
    }
    await onTrace({ type: "model_response_received", payload: { round, status: response.status, durationMs: Date.now() - requestStartedAt } });
    if (!response.ok) throw new DeepSeekError(`DeepSeek request failed with status ${response.status}.`, response.status === 429 ? 503 : 502);
    const payload = await response.json();
    const assistant = payload.choices?.[0]?.message;
    if (!assistant) throw new DeepSeekError("DeepSeek returned an invalid response.");
    await onTrace({ type: "assistant_message", payload: { round, content: assistant.content || "", toolCallCount: assistant.tool_calls?.length || 0, finishReason: payload.choices?.[0]?.finish_reason, usage: payload.usage } });
    if (!assistant.tool_calls?.length) {
      await onProgress({ label: "Preparing final response", status: "complete" });
      if (changes.length && nextCanvas.revision === canvas.revision) nextCanvas.revision += 1;
      if (changes.length) nextCanvas.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      return {
        canvas: nextCanvas,
        reply: assistant.content || (changes.length ? "Canvas updated." : "No canvas changes were made. Use the canvas tools to make a change."),
        changedNodeIds: [...new Set(changes.map((change) => change.nodeId))],
        structureChanged,
        executionRequests,
        cancellationRequests
      };
    }
    messages.push({ role: "assistant", content: assistant.content || "", tool_calls: assistant.tool_calls });
    for (const call of assistant.tool_calls) {
      const toolStartedAt = Date.now();
      await onTrace({ type: "tool_call_started", payload: { round, toolCallId: call.id, toolName: call.function.name, arguments: call.function.arguments } });
      let args;
      try {
        args = parseArguments(call);
      } catch (error) {
        await onTrace({ type: "tool_call_failed", payload: { round, toolCallId: call.id, toolName: call.function.name, error: { name: error.name, message: error.message } } });
        throw error;
      }
      const label = progressLabelByTool[call.function.name];
      if (!label) throw new DeepSeekError(`DeepSeek requested unsupported tool "${call.function.name}".`);
      await onProgress({ label, status: "running" });
      let result;
      if (call.function.name === "get_canvas_structure") {
        result = {
          nodes: nextCanvas.nodes.map(({ id, type, name }) => ({ id, type, name })),
          edges: nextCanvas.edges
        };
      } else if (call.function.name === "list_available_node_types") {
        result = { nodeTypes: canvasNodeTypes };
      } else if (call.function.name === "get_credit_balance") {
        result = account;
      } else if (call.function.name === "build_canvas") {
        if (!Array.isArray(args.nodeTypes) || !args.nodeTypes.length || args.nodeTypes.some((type) => !canvasNodeTypes.includes(type))) {
          throw new DeepSeekError("DeepSeek requested an invalid canvas structure.");
        }
        const existingNodeIds = new Set(nextCanvas.nodes.map((node) => node.id));
        nextCanvas = buildCanvasStructure(message, args.nodeTypes, nextCanvas);
        const addedNodes = nextCanvas.nodes.filter((node) => !existingNodeIds.has(node.id));
        structureChanged = true;
        for (const node of addedNodes) changes.push({ nodeId: node.id, added: true });
        result = {
          frameId: addedNodes.find((node) => node.type === "frame")?.id,
          nodes: addedNodes.filter((node) => node.type !== "frame").map(({ id, type, name }) => ({ id, type, name })),
          edges: nextCanvas.edges.filter((edge) => addedNodes.some((node) => node.id === edge.source.nodeId)).map((edge) => ({ source: edge.source.nodeId, target: edge.target.nodeId }))
        };
      } else if (call.function.name === "get_canvas_parameters") {
        result = {
          nodes: nextCanvas.nodes.map(({ id, type, name }) => ({ id, type, name })),
          parameters: describeCanvasParameters(nextCanvas)
        };
      } else if (call.function.name === "update_node_parameters") {
        const applied = updateNodeParameters(nextCanvas, args.nodeId, args.parameters);
        changes.push(...applied);
        result = { changes: applied };
      } else if (call.function.name === "add_canvas_node") {
        let planned;
        try {
          planned = addCanvasStage(nextCanvas, args.type, message);
        } catch (error) {
          throw new DeepSeekError(error.message);
        }
        nextCanvas = planned.canvas;
        structureChanged ||= planned.structureChanged;
        for (const nodeId of planned.changedNodeIds) changes.push({ nodeId, added: true });
        result = { addedNodeIds: planned.changedNodeIds };
      } else if (call.function.name === "request_user_select") {
        const optionIds = new Set(args.options?.map((option) => option.id));
        if (typeof args.prompt !== "string" || !args.prompt.trim() || !Array.isArray(args.options) || !args.options.length || optionIds.size !== args.options.length || args.options.some((option) => typeof option.id !== "string" || !option.id || typeof option.label !== "string" || !option.label) || !Number.isInteger(args.min) || !Number.isInteger(args.max) || args.min < 1 || args.max < args.min || args.max > args.options.length) {
          throw new DeepSeekError("DeepSeek requested an invalid user selection.");
        }
        const selectionPlan = {
          canvas: nextCanvas,
          changedNodeIds: [...new Set(changes.map((change) => change.nodeId))],
          structureChanged,
          userSelectionRequest: { prompt: args.prompt.trim(), options: args.options, min: args.min, max: args.max }
        };
        await onTrace({ type: "tool_call_succeeded", payload: { round, toolCallId: call.id, toolName: call.function.name, durationMs: Date.now() - toolStartedAt, result: selectionPlan.userSelectionRequest } });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(selectionPlan.userSelectionRequest) });
        await onCheckpoint({ round: round + 1, messages, canvas: nextCanvas, changes, structureChanged, phase: "waiting_for_user" });
        return selectionPlan;
      } else if (call.function.name === "execute_canvas_node") {
        const node = nextCanvas.nodes.find((candidate) => candidate.id === args.nodeId);
        if (!node || !["node", "downstream"].includes(args.mode)) throw new DeepSeekError("DeepSeek requested an invalid node execution.");
        const request = { nodeId: node.id, mode: args.mode };
        executionRequests.push(request);
        result = { accepted: true, ...request, cost: account.executionCost, background: true };
      } else if (call.function.name === "list_canvas_executions") {
        result = { executions };
      } else if (call.function.name === "get_execution_status") {
        const execution = executions.find((candidate) => candidate.id === args.executionId);
        if (!execution) throw new DeepSeekError("Execution not found on the current canvas.");
        result = execution;
      } else if (call.function.name === "cancel_execution") {
        const execution = executions.find((candidate) => candidate.id === args.executionId);
        if (!execution) throw new DeepSeekError("Execution not found on the current canvas.");
        cancellationRequests.push(execution.id);
        result = { accepted: true, executionId: execution.id, status: execution.status };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      await onTrace({ type: "tool_call_succeeded", payload: { round, toolCallId: call.id, toolName: call.function.name, durationMs: Date.now() - toolStartedAt, result } });
      await onProgress({ label, status: "complete" });
    }
    await onCheckpoint({ round: round + 1, messages, canvas: nextCanvas, changes, structureChanged, executionRequests, cancellationRequests, phase: "tool_complete" });
  }
  throw new DeepSeekError("DeepSeek exceeded the tool-call limit.");
}

// server/agent-client.ts
async function runAgentViaService(opts) {
  const { serviceUrl, taskId, turnId, apiKey, baseUrl, model, message, canvas, account, executions, checkpoint, signal, onProgress = async () => {
  }, onTrace = async () => {
  }, onCheckpoint = async () => {
  } } = opts;
  const response = await fetch(serviceUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: taskId || turnId, turnId, apiKey, baseUrl, model, message, canvas, account, executions, checkpoint }),
    signal
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Agent service failed with status ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let plan;
  let cancelled = false;
  let serviceError;
  const handleLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const message2 = JSON.parse(trimmed);
    if (message2.type === "progress") await onProgress(message2.event);
    else if (message2.type === "trace") await onTrace(message2.event);
    else if (message2.type === "checkpoint") await onCheckpoint(message2.checkpoint);
    else if (message2.type === "result") plan = message2.plan;
    else if (message2.type === "cancelled") cancelled = true;
    else if (message2.type === "error") serviceError = message2.error;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      await handleLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  }
  await handleLine(buffer);
  if (serviceError) throw new Error(serviceError);
  if (cancelled) {
    const error = new Error("Agent run cancelled");
    error.name = "AbortError";
    throw error;
  }
  if (!plan) throw new Error("Agent service returned no result");
  return plan;
}
async function cancelAgentViaService(serviceUrl, turnId) {
  const response = await fetch(new URL("cancel", serviceUrl.endsWith("/") ? serviceUrl : `${serviceUrl}/`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: turnId, turnId })
  });
  if (!response.ok) throw new Error("Agent service could not stop the run");
}

// server/projects.ts
function withResultSlots(canvas) {
  const repair = reconcileResultSlots({ nodes: canvas.nodes || [], edges: canvas.edges || [], provider: canvas.provider });
  if (!repair.added.length && !repair.removed.length) return canvas;
  return { ...canvas, nodes: repair.canvas.nodes, edges: repair.canvas.edges };
}
function projectDto(canvas) {
  return {
    id: canvas.id,
    name: canvas.name,
    description: canvas.description,
    provider: canvas.provider,
    revision: canvas.revision,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length
  };
}
function replaceCanvasDocument(project, input, canvasId, updatedAt) {
  const repaired = withResultSlots({ ...input, provider: input.provider ?? project.provider });
  const changed = documentChanged(project, repaired);
  return {
    ...input,
    ...repaired.nodes === input.nodes ? {} : { nodes: repaired.nodes, edges: repaired.edges },
    id: canvasId,
    name: project.name,
    description: project.description,
    provider: input.provider ?? project.provider,
    createdAt: project.createdAt,
    revision: changed ? project.revision + 1 : project.revision,
    updatedAt: changed ? updatedAt : project.updatedAt,
    ...project.ownerId ? { ownerId: project.ownerId } : {}
  };
}
function documentChanged(project, input) {
  return JSON.stringify(project.nodes || []) !== JSON.stringify(input.nodes || []) || JSON.stringify(project.edges || []) !== JSON.stringify(input.edges || []) || JSON.stringify(project.wireTies || []) !== JSON.stringify(input.wireTies || []);
}
function applyAgentCanvas(project, canvas) {
  return withResultSlots({
    ...canvas,
    name: project.name,
    description: project.description,
    provider: project.provider,
    createdAt: project.createdAt,
    ...project.ownerId ? { ownerId: project.ownerId } : {}
  });
}

// server/agent-traces.ts
function createAgentTrace(turn, config = {}, now = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    id: `trace-${randomUUID()}`,
    turnId: turn.id,
    sessionId: turn.sessionId,
    canvasId: turn.canvasId,
    provider: "deepseek",
    model: config.model || "deepseek-chat",
    runtime: config.runtime || "direct",
    status: "queued",
    attempt: 0,
    resumeCount: 0,
    createdAt: now,
    updatedAt: now,
    events: []
  };
}
function appendAgentTrace(trace, type, payload = {}, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const safePayload = sanitizeTraceValue(payload);
  const event = {
    id: `trace-event-${randomUUID()}`,
    seq: (trace.events.at(-1)?.seq || 0) + 1,
    type,
    timestamp: now,
    payload: safePayload
  };
  trace.events.push(event);
  trace.updatedAt = now;
  return event;
}
function checkpointAgentTrace(trace, checkpoint, now = (/* @__PURE__ */ new Date()).toISOString()) {
  trace.checkpoint = { ...structuredClone(checkpoint), updatedAt: now };
  trace.updatedAt = now;
  return trace.checkpoint;
}
function sanitizeAgentError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    status: error?.status
  };
}
function sanitizeTraceValue(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return value.length > 2e4 ? `${value.slice(0, 2e4)}...[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeTraceValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(authorization|api[-_]?key|token|secret)$/i.test(key)) sanitized[key] = "[redacted]";
    else sanitized[key] = sanitizeTraceValue(item, depth + 1);
  }
  return sanitized;
}

// server/credits.ts
var DEFAULT_ACCOUNT_ID = "demo-user";
var EXECUTION_CREDIT_COST = 10;
function defaultAccount(id = DEFAULT_ACCOUNT_ID) {
  return {
    id,
    name: "Visitor",
    balance: 1e3
  };
}
function accountDto(state, visitorId = DEFAULT_ACCOUNT_ID) {
  if (!visitorId) return null;
  return state.accounts.find((account) => account.id === visitorId) || null;
}
function ensureVisitorAccount(state, visitorId) {
  const existing = accountDto(state, visitorId);
  if (existing) return { account: existing, created: false };
  const account = defaultAccount(visitorId);
  state.accounts.push(account);
  return { account, created: true };
}
function reserveExecutionCredits(state, run, now = () => (/* @__PURE__ */ new Date()).toISOString(), visitorId = DEFAULT_ACCOUNT_ID) {
  const account = accountDto(state, visitorId);
  if (!account) throw new Error("Visitor account is unavailable");
  if (state.creditLedger.some((entry) => entry.runId === run.id && entry.type === "execution_charge")) return account;
  if (account.balance < EXECUTION_CREDIT_COST) {
    const error = new Error(`Insufficient credits. This execution costs ${EXECUTION_CREDIT_COST} credits.`);
    error.statusCode = 402;
    throw error;
  }
  account.balance -= EXECUTION_CREDIT_COST;
  state.creditLedger.push({
    id: `charge-${run.id}`,
    accountId: account.id,
    runId: run.id,
    type: "execution_charge",
    amount: -EXECUTION_CREDIT_COST,
    createdAt: now()
  });
  return account;
}
function settleExecutionCredits(state, run, now = () => (/* @__PURE__ */ new Date()).toISOString()) {
  if (!["failed", "cancelled"].includes(run?.status)) return false;
  const charged = state.creditLedger.find((entry) => entry.runId === run.id && entry.type === "execution_charge");
  const refunded = state.creditLedger.some((entry) => entry.runId === run.id && entry.type === "execution_refund");
  if (!charged || refunded) return false;
  const account = accountDto(state, charged.accountId);
  if (!account) throw new Error("Visitor account is unavailable");
  account.balance += EXECUTION_CREDIT_COST;
  state.creditLedger.push({
    id: `refund-${run.id}`,
    accountId: account.id,
    runId: run.id,
    type: "execution_refund",
    amount: EXECUTION_CREDIT_COST,
    createdAt: now()
  });
  return true;
}

// server/visitor.ts
var VISITOR_COOKIE = "forge3d_visitor";
var ONE_YEAR = 60 * 60 * 24 * 365;
var VISITOR_ID = /^visitor-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function readVisitor(request) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== VISITOR_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    if (VISITOR_ID.test(value)) return { visitorId: value, isNew: false };
  }
  return { visitorId: `visitor-${globalThis.crypto.randomUUID()}`, isNew: true };
}
function visitorCookie(visitorId, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure}`;
}

// server/api-core.ts
var AGENT_COLLECTIONS = ["canvases", "sessions", "turns", "agentTraces"];
var CREDIT_COLLECTIONS = ["runs", "accounts", "creditLedger"];
function json(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
async function parseJson(request) {
  return request.json().catch(() => ({}));
}
function withStarterGraph(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const nodes = input.nodes;
  const edges = input.edges;
  if (!Array.isArray(nodes) || nodes.length || edges != null && (!Array.isArray(edges) || edges.length)) return input;
  const starter = starterCanvasGraph();
  return { ...input, nodes: starter.nodes, edges: starter.edges, viewport: starterCanvasViewport };
}
function meshyTaskRef(nodeRun) {
  const taskId = nodeRun?.meshyTaskId || nodeRun?.output?.meshyTaskId;
  if (!taskId) return null;
  return { taskId, endpoint: nodeRun.meshyTaskEndpoint || nodeRun.output?.meshyTaskEndpoint || null };
}
function meshyUrls(nodeRun) {
  const output = nodeRun?.output || {};
  const downloads = Array.isArray(output.outputs) ? output.outputs.map((item) => item?.downloadUrl) : [];
  return [output.modelUrl, output.preview, ...downloads].filter((url) => typeof url === "string" && url);
}
function findMeshyTask(runs, execution, nodeId) {
  const nodeRun = execution?.nodeRuns?.[nodeId];
  const own = meshyTaskRef(nodeRun);
  if (own) return own;
  const wanted = new Set(meshyUrls(nodeRun));
  if (!wanted.size) return null;
  for (const run of runs) {
    if (execution?.canvasId && run.canvasId && run.canvasId !== execution.canvasId) continue;
    for (const other of Object.values(run.nodeRuns || {})) {
      const ref = meshyTaskRef(other);
      if (ref && meshyUrls(other).some((url) => wanted.has(url))) return ref;
    }
  }
  return null;
}
async function fetchMeshyAsset(url, signal) {
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, { signal, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return response;
    const next = new URL(location, current);
    const meshyHost = next.hostname === "meshy.ai" || next.hostname.endsWith(".meshy.ai");
    if (next.protocol !== "https:" || !meshyHost) return response;
    current = next;
  }
  return fetch(current, { signal, redirect: "manual" });
}
async function streamMeshyAsset(request, config, taskRef, kind) {
  if (!config.getMeshyTask) return json({ error: "Meshy is not configured." }, 503);
  if (!taskRef) return json({ error: "Meshy model task not found" }, 404);
  const task = await config.getMeshyTask(taskRef.taskId, taskRef.endpoint);
  const remote = kind === "preview" ? task?.thumbnail_url : task?.model_urls?.glb;
  if (!remote) return json({ error: kind === "preview" ? "Meshy task has no preview" : "Meshy task has no GLB model" }, 404);
  const asset = await fetchMeshyAsset(remote, request.signal);
  if (!asset.ok || !asset.body) return json({ error: "Meshy asset could not be loaded" }, 502);
  const headers = {
    "content-type": asset.headers.get("content-type") || (kind === "preview" ? "image/png" : "model/gltf-binary"),
    "cache-control": "private, no-store, no-transform"
  };
  const length = asset.headers.get("content-length");
  if (length) headers["content-length"] = length;
  if (length && !asset.headers.get("content-encoding")) headers["x-file-size"] = length;
  headers["access-control-expose-headers"] = "content-length, x-file-size";
  if (kind === "model") headers["content-disposition"] = 'inline; filename="model.glb"';
  return new Response(asset.body, { headers });
}
function createChannels() {
  const subscribers = /* @__PURE__ */ new Map();
  const sequences = /* @__PURE__ */ new Map();
  return {
    subscribe(canvasId, sink) {
      const sinks = subscribers.get(canvasId) || /* @__PURE__ */ new Set();
      sinks.add(sink);
      subscribers.set(canvasId, sinks);
      return () => {
        sinks.delete(sink);
        if (!sinks.size) subscribers.delete(canvasId);
      };
    },
    event(turn, type, fields = {}) {
      const seq = (sequences.get(turn.canvasId) || 0) + 1;
      sequences.set(turn.canvasId, seq);
      return {
        id: `${seq}-0`,
        data: { type, canvas_id: turn.canvasId, session_id: turn.sessionId, turn_id: turn.id, ...fields }
      };
    },
    notification(canvasId, type, fields = {}) {
      const seq = (sequences.get(canvasId) || 0) + 1;
      sequences.set(canvasId, seq);
      return { id: `${seq}-0`, data: { type, canvas_id: canvasId, ...fields } };
    },
    broadcast(canvasId, event) {
      const frame2 = `event: ${event.data.type === "error" ? "error" : "message"}
data: ${JSON.stringify(event.data)}
id: ${event.id}

`;
      for (const sink of subscribers.get(canvasId) || []) sink(frame2);
    }
  };
}
var SSE_IDLE_TIMEOUT_MS = 10 * 60 * 1e3;
function sseResponse(canvasId, signal, channels, idleTimeoutMs = SSE_IDLE_TIMEOUT_MS) {
  let unsubscribe = () => {
  };
  let keepalive = null;
  let idleTimeout = null;
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const armIdleTimeout = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          send('event: end\ndata: {"type":"sse-end","reason":"idle-timeout"}\n\n');
          close();
        }, idleTimeoutMs);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        clearTimeout(idleTimeout);
        unsubscribe();
        try {
          controller.close();
        } catch {
        }
      };
      const send = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
          if (!text.startsWith(":")) armIdleTimeout();
        } catch {
          close();
        }
      };
      send(": subscribed\n\n");
      unsubscribe = channels.subscribe(canvasId, send);
      keepalive = setInterval(() => send(": keepalive\n\n"), 15e3);
      armIdleTimeout();
      signal?.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(keepalive);
      clearTimeout(idleTimeout);
      unsubscribe();
      closed = true;
    }
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    }
  });
}
function resolveProviderFactory(config, provider) {
  const fail = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
  };
  if (!["mock", "tripo", "meshy"].includes(provider)) fail('Canvas provider must be "mock", "tripo", or "meshy"', 400);
  if (provider === "mock") return null;
  if (provider === "tripo" && !config.createTripoProvider) {
    fail("Tripo is not configured. Set TRIPO_API_KEY and restart the API server.", 503);
  }
  if (provider === "meshy" && !config.createMeshyProvider) {
    fail("Meshy is not configured. Add a Meshy API key.", 503);
  }
  return provider === "tripo" ? config.createTripoProvider : config.createMeshyProvider;
}
function createApi({ createContext, sseIdleTimeoutMs = SSE_IDLE_TIMEOUT_MS }) {
  const channels = createChannels();
  const canvasLeases = /* @__PURE__ */ new Map();
  const leaseExpiryTimers = /* @__PURE__ */ new Map();
  const LEASE_DURATION_MS = 3e4;
  function currentLease(canvasId) {
    const lease = canvasLeases.get(canvasId);
    if (lease && lease.expiresAt > Date.now()) return lease;
    if (lease) {
      canvasLeases.delete(canvasId);
      clearTimeout(leaseExpiryTimers.get(canvasId));
      leaseExpiryTimers.delete(canvasId);
    }
    return null;
  }
  function broadcastLease(canvasId) {
    channels.broadcast(canvasId, channels.notification(canvasId, "presence", { lease: currentLease(canvasId) }));
  }
  function scheduleLeaseExpiry(canvasId, lease) {
    clearTimeout(leaseExpiryTimers.get(canvasId));
    leaseExpiryTimers.set(canvasId, setTimeout(() => {
      if (canvasLeases.get(canvasId) !== lease) return;
      canvasLeases.delete(canvasId);
      leaseExpiryTimers.delete(canvasId);
      broadcastLease(canvasId);
    }, LEASE_DURATION_MS + 10));
  }
  const meshyPolls = /* @__PURE__ */ new Map();
  function withMeshyPoll(id, operation) {
    const previous = meshyPolls.get(id) || Promise.resolve();
    const pending = previous.catch(() => {
    }).then(operation);
    meshyPolls.set(id, pending);
    pending.finally(() => {
      if (meshyPolls.get(id) === pending) meshyPolls.delete(id);
    });
    return pending;
  }
  const canvasTurnQueues = /* @__PURE__ */ new Map();
  const activeTurnIds = /* @__PURE__ */ new Set();
  const activeTurnCancels = /* @__PURE__ */ new Map();
  let creditMutation = Promise.resolve();
  let recovered = false;
  function mutateCredits(operation) {
    const pending = creditMutation.catch(() => {
    }).then(operation);
    creditMutation = pending;
    return pending;
  }
  async function settlePaidExecution(store2, run) {
    return mutateCredits(async () => {
      await store2.reload(["accounts", "creditLedger"]);
      const refunded = settleExecutionCredits(store2.state, run);
      await store2.persist(refunded ? CREDIT_COLLECTIONS : ["runs"]);
      return refunded;
    });
  }
  async function startPaidExecution(context2, canvas, node, mode, createProvider = null, options2 = {}) {
    const { store: store2, waitUntil } = context2;
    const { state } = store2;
    const pending = await mutateCredits(async () => {
      await store2.reload(["accounts", "creditLedger"]);
      ensureVisitorAccount(state, canvas.ownerId);
      const existing = options2.idempotencyKey && state.runs.find((run) => run.canvasId === canvas.id && run.idempotencyKey === options2.idempotencyKey);
      if (existing) return { run: existing, duplicate: true };
      if (options2.enforceActiveTaskLimit) assertProjectExecutionCapacity(state.runs, canvas.id);
      const created = createExecution(state.runs, canvas, node, mode, options2);
      try {
        reserveExecutionCredits(state, created.run, void 0, canvas.ownerId);
        await store2.persist(CREDIT_COLLECTIONS);
        return created;
      } catch (error) {
        state.runs.splice(state.runs.indexOf(created.run), 1);
        throw error;
      }
    });
    if (!pending.duplicate) waitUntil(executeExecution(
      state.runs,
      pending.run,
      canvas,
      pending.executionCanvas,
      pending.nodes,
      node,
      () => settlePaidExecution(store2, pending.run),
      { createProvider }
    ).catch(console.error));
    return pending.run;
  }
  async function executeAgentTurn(context2, turn) {
    const { store: store2, config } = context2;
    const { state } = store2;
    const canvasById = (id) => state.canvases.find((canvas) => canvas.id === id);
    const sessionById = (id) => state.sessions.find((session) => session.id === id);
    const turnById = (id) => state.turns.find((item) => item.id === id);
    const traceByTurnId = (id) => state.agentTraces.find((trace2) => trace2.turnId === id);
    const reloadAgentCollections = () => store2.reload(AGENT_COLLECTIONS);
    const emit = (type, fields) => channels.broadcast(turn.canvasId, channels.event(turn, type, fields));
    let trace;
    const mutateTrace = (operation) => {
      trace = traceByTurnId(turn.id) || trace;
      if (!trace) return Promise.resolve();
      operation(trace);
      return store2.persist(["agentTraces"]);
    };
    const recordTrace = (type, payload = {}, updates = {}) => mutateTrace((currentTrace) => {
      Object.assign(currentTrace, updates);
      appendAgentTrace(currentTrace, type, payload);
    });
    const saveCheckpoint = (checkpoint) => mutateTrace((currentTrace) => checkpointAgentTrace(currentTrace, checkpoint));
    try {
      await reloadAgentCollections();
      const startingTurn = turnById(turn.id);
      if (!startingTurn) throw new Error("Turn was deleted before it started");
      if (startingTurn.status === "cancelled" || startingTurn.status === "cancelling") return;
      Object.assign(startingTurn, turn);
      turn = startingTurn;
      trace = traceByTurnId(turn.id);
      turn.attempt = (turn.attempt || 0) + 1;
      turn.status = "running";
      turn.startedAt = (/* @__PURE__ */ new Date()).toISOString();
      await store2.persist(["turns"]);
      if (trace) {
        await recordTrace(turn.attempt > 1 ? "turn_resumed" : "turn_started", { attempt: turn.attempt }, { status: "running", attempt: turn.attempt });
      }
      emit("turn-start");
      const canvas = canvasById(turn.canvasId);
      if (!canvas) throw new Error("Canvas not found");
      const session = sessionById(turn.sessionId);
      if (!session) throw new Error("Session not found");
      const serviceUrl = config.agentServiceUrl;
      const runAgent = serviceUrl ? runAgentViaService : runDeepSeekAgent;
      const controller = new AbortController();
      const cancel = async () => {
        if (serviceUrl) await cancelAgentViaService(serviceUrl, turn.id);
        controller.abort();
      };
      activeTurnCancels.set(turn.id, cancel);
      let plan;
      try {
        plan = await runAgent({
          serviceUrl,
          taskId: turn.id,
          turnId: turn.id,
          signal: controller.signal,
          apiKey: config.deepseek.apiKey,
          baseUrl: config.deepseek.baseUrl,
          model: config.deepseek.model,
          message: turn.selection ? `${turn.message}

The user selected: ${turn.selection.selected_option_ids.map((optionId) => turn.request.options.find((option) => option.id === optionId)?.label || optionId).join(", ")}. Continue the turn using this selection.` : turn.message,
          canvas,
          account: { ...accountDto(state, canvas.ownerId), executionCost: EXECUTION_CREDIT_COST },
          executions: canvasExecutions(state.runs, canvas.id),
          history: session.messages || [],
          checkpoint: ["tool_complete", "waiting_for_user"].includes(trace?.checkpoint?.phase) ? trace.checkpoint : void 0,
          onTrace: (event) => recordTrace(event.type, event.payload),
          onCheckpoint: saveCheckpoint,
          onProgress: async (event) => {
            turn.progress.push(event);
            turn.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
            await reloadAgentCollections();
            const currentTurn2 = turnById(turn.id);
            if (!currentTurn2 || !canvasById(turn.canvasId)) throw new Error("Project or turn was deleted while this turn was running");
            Object.assign(currentTurn2, turn);
            turn = currentTurn2;
            await store2.persist(["turns"]);
            emit("progress", { step_id: `progress-${turn.progress.length}`, ...event });
          }
        });
      } finally {
        if (activeTurnCancels.get(turn.id) === cancel) activeTurnCancels.delete(turn.id);
      }
      await reloadAgentCollections();
      const currentTurn = turnById(turn.id);
      if (!canvasById(turn.canvasId) || !sessionById(turn.sessionId) || !currentTurn) throw new Error("Project, session, or turn was deleted while this turn was running");
      if (currentTurn.status === "cancelled" || currentTurn.status === "cancelling") return;
      turn = currentTurn;
      if (plan.canvas && plan.canvas.id !== turn.canvasId) throw new Error("Agent returned a canvas outside this project");
      if (plan.userSelectionRequest) {
        delete turn.selection;
        turn.request = { request_id: `request-${randomUUID()}`, ...plan.userSelectionRequest };
        const now2 = (/* @__PURE__ */ new Date()).toISOString();
        const sessionIndex = state.sessions.findIndex((item) => item.id === turn.sessionId);
        if (sessionIndex < 0 || !turnById(turn.id)) throw new Error("Session or turn was deleted while this turn was running");
        const nextSession2 = structuredClone(state.sessions[sessionIndex]);
        if (!nextSession2.messages.some((message) => message.turnId === turn.id && message.role === "user")) {
          nextSession2.messages.push({ id: `msg-${randomUUID()}`, role: "user", content: turn.message, attachments: turn.attachments || [], turnId: turn.id, createdAt: now2 });
        }
        const requestMessage = { id: `msg-${randomUUID()}`, role: "assistant", content: "", turnId: turn.id, request: turn.request, progress: turn.progress, createdAt: now2 };
        nextSession2.messages.push(requestMessage);
        nextSession2.updatedAt = now2;
        turn.requestMessageId = requestMessage.id;
        turn.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        state.sessions[sessionIndex] = nextSession2;
        await store2.persist(["sessions", "turns"]);
        if (trace) {
          await recordTrace("turn_waiting_for_user", { request: turn.request }, { status: "waiting_for_user" });
        }
        emit("request_user_select", { request: turn.request });
        return;
      }
      const canvasIndex = state.canvases.findIndex((item) => item.id === turn.canvasId);
      if (canvasIndex < 0) throw new Error("Project was deleted while this turn was running");
      const executionCanvas = applyAgentCanvas(state.canvases[canvasIndex], plan.canvas);
      const executionRequests = plan.executionRequests || (plan.executionRequest ? [plan.executionRequest] : []);
      const startedExecutions = [];
      for (const executionRequest of executionRequests) {
        const requestedNode = executionCanvas.nodes.find((node) => node.id === executionRequest.nodeId);
        if (!requestedNode) throw new Error("Agent requested a node outside this canvas");
        startedExecutions.push(executionDto(await startPaidExecution(context2, executionCanvas, requestedNode, executionRequest.mode, resolveProviderFactory(config, executionCanvas.provider))));
      }
      for (const executionId of plan.cancellationRequests || []) {
        const execution = executionById(state.runs, executionId);
        if (execution && execution.canvasId === turn.canvasId) {
          cancelExecution(execution);
          await settlePaidExecution(store2, execution);
        }
      }
      if (startedExecutions.length) plan.executions = startedExecutions;
      const nextSession = sessionById(turn.sessionId);
      if (!nextSession || !turnById(turn.id)) throw new Error("Session or turn was deleted while this turn was running");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const assistantMessageId = `msg-${randomUUID()}`;
      nextSession.messages.push({ id: assistantMessageId, role: "assistant", content: plan.reply, progress: turn.progress, turnId: turn.id, createdAt: now });
      nextSession.updatedAt = now;
      turn.status = "succeeded";
      turn.result = structuredClone({ ...plan, session: nextSession });
      turn.completedAt = (/* @__PURE__ */ new Date()).toISOString();
      turn.updatedAt = turn.completedAt;
      await store2.persist(["sessions", "turns"]);
      if (trace) {
        await recordTrace("turn_succeeded", { changedNodeIds: plan.changedNodeIds, structureChanged: plan.structureChanged }, { status: "succeeded", completedAt: turn.completedAt });
      }
      emit("text", { step_id: "final-response", id: assistantMessageId, text: plan.reply });
      emit("agent-result", {
        source_client_id: turn.clientId,
        plan: structuredClone(plan)
      });
      emit("finish", { finish_reason: "stop" });
    } catch (error) {
      await store2.reload(["turns"]).catch(() => {
      });
      const latestTurn = turnById(turn.id);
      if (latestTurn?.status === "cancelled" || latestTurn?.status === "cancelling" || error?.name === "AbortError") {
        if (latestTurn) {
          latestTurn.status = "cancelled";
          latestTurn.completedAt ||= (/* @__PURE__ */ new Date()).toISOString();
          latestTurn.updatedAt = latestTurn.completedAt;
          await store2.persist(["turns"]).catch(() => {
          });
          await recordTrace("turn_cancelled").catch(() => {
          });
        }
        return;
      }
      turn.status = "failed";
      turn.error = error.message;
      turn.completedAt = (/* @__PURE__ */ new Date()).toISOString();
      turn.updatedAt = turn.completedAt;
      try {
        await reloadAgentCollections();
        const currentTurn = turnById(turn.id);
        if (currentTurn && canvasById(turn.canvasId)) {
          Object.assign(currentTurn, turn);
          await store2.persist(["turns"]);
        }
      } catch {
      }
      if (trace) {
        await recordTrace("turn_failed", { error: sanitizeAgentError(error) }, { status: "failed", completedAt: turn.completedAt }).catch(() => {
        });
      }
      emit("error", { error: turn.error });
    }
  }
  function enqueueAgentTurn(context2, turn) {
    activeTurnIds.add(turn.id);
    const previous = canvasTurnQueues.get(turn.canvasId) || Promise.resolve();
    const current = previous.catch(() => {
    }).then(() => executeAgentTurn(context2, turn)).finally(() => {
      activeTurnIds.delete(turn.id);
      if (canvasTurnQueues.get(turn.canvasId) === current) canvasTurnQueues.delete(turn.canvasId);
    });
    canvasTurnQueues.set(turn.canvasId, current);
    return current;
  }
  function startAgentTurn(context2, turn) {
    return enqueueAgentTurn(context2, turn);
  }
  async function recoverAgentTurns(context2) {
    if (recovered || !context2.recoverAgentTurns) return;
    recovered = true;
    await context2.store.reload(AGENT_COLLECTIONS);
    const { state } = context2.store;
    const recoverable = state.turns.filter((turn) => !turn.request && ["queued", "running"].includes(turn.status));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const turn of recoverable) {
      if (turn.status === "running") {
        turn.status = "queued";
        turn.interruptedAt = now;
        turn.resumeCount = (turn.resumeCount || 0) + 1;
        const trace = state.agentTraces.find((item) => item.turnId === turn.id);
        if (trace) {
          trace.resumeCount = turn.resumeCount;
          appendAgentTrace(trace, "turn_recovered", { previousStatus: "running", resumeCount: turn.resumeCount }, now);
        }
      }
      turn.updatedAt = now;
    }
    if (recoverable.length) await context2.store.persist(["turns", "agentTraces"]);
    for (const turn of recoverable) context2.waitUntil(startAgentTurn(context2, turn));
  }
  async function route(request, context2) {
    const { store: store2, config, waitUntil } = context2;
    const { state } = store2;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const method = request.method;
    const { visitorId } = context2;
    const ownsCanvas = (canvas) => canvas.ownerId === visitorId;
    const ownedCanvasIndex = (id) => state.canvases.findIndex((canvas) => canvas.id === id && ownsCanvas(canvas));
    const canvasById = (id) => state.canvases.find((canvas) => canvas.id === id && ownsCanvas(canvas));
    const sessionById = (id) => state.sessions.find((session) => session.id === id && canvasById(session.canvasId));
    const turnById = (id) => state.turns.find((turn) => turn.id === id && canvasById(turn.canvasId));
    const ownedExecution = (id) => {
      const execution = executionById(state.runs, id);
      return execution && canvasById(execution.canvasId) ? execution : null;
    };
    if (parts[0] !== "api") return json({ error: "Not found" }, 404);
    if (method === "GET" && parts[1] === "account" && parts.length === 2) {
      const { account, created } = ensureVisitorAccount(state, visitorId);
      if (created) await store2.persist(["accounts"]);
      return json({ ...account, executionCost: EXECUTION_CREDIT_COST });
    }
    if (method === "GET" && parts[1] === "turns" && parts[3] === "trace" && parts.length === 4) {
      const turn = turnById(parts[2]);
      if (!turn) return json({ error: "Turn not found" }, 404);
      const trace = state.agentTraces.find((item) => item.turnId === turn.id);
      if (!trace) return json({ error: "Agent trace not found" }, 404);
      const afterValue = url.searchParams.get("after") || "0";
      if (!/^\d+$/.test(afterValue)) return json({ error: "after must be a non-negative integer" }, 400);
      const after = Number(afterValue);
      return json({ ...trace, events: trace.events.filter((event) => event.seq > after) });
    }
    if (method === "GET" && parts[1] === "capabilities" && parts.length === 2) {
      return json({
        providers: { mock: true, tripo: Boolean(config.createTripoProvider), meshy: Boolean(config.createMeshyProvider) },
        defaultProvider: config.createMeshyProvider ? "meshy" : config.createTripoProvider ? "tripo" : "mock",
        tripoNodeTypes: [...tripoNodeTypes],
        meshyNodeTypes: [...meshyNodeTypes]
      });
    }
    if (method === "GET" && parts[1] === "meshy" && parts[2] === "assets" && parts.length === 3) {
      const assetUrl = url.searchParams.get("url");
      let remoteUrl;
      try {
        remoteUrl = new URL(assetUrl || "");
      } catch {
        return json({ error: "A valid Meshy asset URL is required" }, 400);
      }
      if (remoteUrl.protocol !== "https:" || remoteUrl.hostname !== "assets.meshy.ai") {
        return json({ error: "Only Meshy asset URLs can be previewed" }, 400);
      }
      const asset = await fetchMeshyAsset(remoteUrl, request.signal);
      if (!asset.ok || !asset.body) return json({ error: "Meshy asset could not be loaded" }, 502);
      const headers = {
        "content-type": asset.headers.get("content-type") || "model/gltf-binary",
        "cache-control": "private, no-store, no-transform"
      };
      const length = asset.headers.get("content-length");
      if (length) headers["content-length"] = length;
      if (length && !asset.headers.get("content-encoding")) headers["x-file-size"] = length;
      headers["access-control-expose-headers"] = "content-length, x-file-size";
      return new Response(asset.body, { headers });
    }
    if (method === "GET" && parts[1] === "executions" && parts[2] && parts[3] === "nodes" && parts[4] && (parts[5] === "model" || parts[5] === "preview") && parts.length === 6) {
      const execution = ownedExecution(parts[2]);
      return streamMeshyAsset(request, config, execution && findMeshyTask(state.runs, execution, parts[4]), parts[5]);
    }
    if (method === "GET" && parts[1] === "projects" && parts.length === 2) {
      return json(state.canvases.filter(ownsCanvas).map(projectDto));
    }
    if (method === "POST" && parts[1] === "projects" && parts.length === 2) {
      const canvas = withResultSlots(createCanvas({ ...withStarterGraph(await parseJson(request)), ownerId: visitorId }));
      state.canvases.push(canvas);
      state.sessions.push(createInitialSession(canvas));
      await store2.persist(["canvases", "sessions"]);
      return json(projectDto(canvas), 201);
    }
    if (method === "GET" && parts[1] === "projects" && parts.length === 3) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Project not found" }, 404);
      return json(projectDto(canvas));
    }
    if (method === "PATCH" && parts[1] === "projects" && parts.length === 3) {
      const index = ownedCanvasIndex(parts[2]);
      if (index < 0) return json({ error: "Project not found" }, 404);
      const input = await parseJson(request);
      if (typeof input.name === "string" && !input.name.trim()) return json({ error: "Project name is required" }, 400);
      if (input.provider !== void 0 && !["mock", "tripo", "meshy"].includes(input.provider)) return json({ error: 'Canvas provider must be "mock", "tripo", or "meshy"' }, 400);
      if (input.provider !== void 0 && input.provider !== state.canvases[index].provider && state.canvases[index].nodes.length) return json({ error: "Canvas provider cannot be changed after nodes are added" }, 409);
      const providerChanged = input.provider !== void 0 && input.provider !== state.canvases[index].provider;
      if (typeof input.name === "string") state.canvases[index].name = input.name.trim();
      if (typeof input.description === "string") state.canvases[index].description = input.description.trim();
      if (input.provider !== void 0) state.canvases[index].provider = input.provider;
      if (providerChanged) state.canvases[index].revision += 1;
      state.canvases[index].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await store2.persist(["canvases"]);
      return json(projectDto(state.canvases[index]));
    }
    if (method === "DELETE" && parts[1] === "projects" && parts.length === 3) {
      const index = ownedCanvasIndex(parts[2]);
      if (index < 0) return json({ error: "Project not found" }, 404);
      state.canvases.splice(index, 1);
      state.sessions = state.sessions.filter((session) => session.canvasId !== parts[2]);
      state.runs = state.runs.filter((run) => run.canvasId !== parts[2]);
      state.turns = state.turns.filter((turn) => turn.canvasId !== parts[2]);
      state.agentTraces = state.agentTraces.filter((trace) => trace.canvasId !== parts[2]);
      await store2.removeCanvas(parts[2]);
      await store2.persist(["canvases", "sessions", "runs", "turns", "agentTraces"]);
      return json(null, 204);
    }
    if (method === "POST" && parts[1] === "projects" && parts[3] === "duplicate" && parts.length === 4) {
      const source = canvasById(parts[2]);
      if (!source) return json({ error: "Project not found" }, 404);
      const canvas = withResultSlots(duplicateCanvas({ ...source, ownerId: visitorId }));
      const now = canvas.createdAt;
      state.canvases.push(canvas);
      state.sessions.push({ id: `session-${randomUUID()}`, canvasId: canvas.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${randomUUID()}`, role: "assistant", content: "This canvas was duplicated and can now evolve independently.", createdAt: now }] });
      await store2.persist(["canvases", "sessions"]);
      return json(projectDto(canvas), 201);
    }
    if (method === "GET" && parts[1] === "canvases" && parts.length === 3) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Canvas not found" }, 404);
      return json({ canvas, nodeRuns: latestNodeRuns(canvas, state.runs) });
    }
    if (method === "PUT" && parts[1] === "canvases" && parts.length === 3) {
      const index = ownedCanvasIndex(parts[2]);
      if (index < 0) return json({ error: "Canvas not found" }, 404);
      const input = await parseJson(request);
      if (!Number.isInteger(input.baseRevision)) return json({ error: "baseRevision is required" }, 400);
      if (!input.canvas || typeof input.canvas !== "object") return json({ error: "canvas is required" }, 400);
      if (input.baseRevision !== state.canvases[index].revision) {
        return json({ error: "Canvas was updated elsewhere", canvas: state.canvases[index] }, 409);
      }
      const nextProvider = input.canvas.provider ?? state.canvases[index].provider;
      if (!["mock", "tripo", "meshy"].includes(nextProvider)) return json({ error: 'Canvas provider must be "mock", "tripo", or "meshy"' }, 400);
      if (nextProvider !== state.canvases[index].provider && (state.canvases[index].nodes.length || input.canvas.nodes?.length)) return json({ error: "Canvas provider cannot be changed after nodes are added" }, 409);
      state.canvases[index] = replaceCanvasDocument(state.canvases[index], input.canvas, parts[2], (/* @__PURE__ */ new Date()).toISOString());
      await store2.persist(["canvases"]);
      channels.broadcast(parts[2], channels.notification(parts[2], "canvas-updated", {
        revision: state.canvases[index].revision,
        source_client_id: input.clientId
      }));
      return json(state.canvases[index]);
    }
    if (method === "GET" && parts[1] === "canvases" && parts[2] && parts[3] === "presence" && parts.length === 4) {
      if (!canvasById(parts[2])) return json({ error: "Canvas not found" }, 404);
      return json({ lease: currentLease(parts[2]) });
    }
    if (method === "POST" && parts[1] === "canvases" && parts[2] && parts[3] === "presence" && parts.length === 4) {
      if (!canvasById(parts[2])) return json({ error: "Canvas not found" }, 404);
      const input = await parseJson(request);
      if (typeof input.clientId !== "string" || !input.clientId) return json({ error: "clientId is required" }, 400);
      const lease = currentLease(parts[2]);
      if (lease && lease.clientId !== input.clientId) return json({ error: `${lease.displayName} is editing this canvas`, lease }, 423);
      const nextLease = {
        clientId: input.clientId,
        displayName: typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim() : "Another user",
        expiresAt: Date.now() + LEASE_DURATION_MS
      };
      canvasLeases.set(parts[2], nextLease);
      scheduleLeaseExpiry(parts[2], nextLease);
      broadcastLease(parts[2]);
      return json({ lease: nextLease });
    }
    if (method === "DELETE" && parts[1] === "canvases" && parts[2] && parts[3] === "presence" && parts.length === 4) {
      const clientId = url.searchParams.get("clientId");
      if (currentLease(parts[2])?.clientId === clientId) {
        canvasLeases.delete(parts[2]);
        clearTimeout(leaseExpiryTimers.get(parts[2]));
        leaseExpiryTimers.delete(parts[2]);
        broadcastLease(parts[2]);
      }
      return json(null, 204);
    }
    if (method === "GET" && parts[1] === "canvases" && parts[2] && parts[3] === "sessions" && parts.length === 4) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Canvas not found" }, 404);
      let sessions = state.sessions.filter((session) => session.canvasId === canvas.id);
      if (!sessions.length) {
        const session = createInitialSession(canvas);
        state.sessions.push(session);
        await store2.persist(["sessions"]);
        sessions = [session];
      }
      return json(sessions);
    }
    if (method === "POST" && parts[1] === "canvases" && parts[2] && parts[3] === "sessions" && parts.length === 4) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Canvas not found" }, 404);
      const session = createSession(canvas);
      state.sessions.push(session);
      await store2.persist(["sessions"]);
      return json(session, 201);
    }
    if (method === "GET" && parts[1] === "canvases" && parts[2] && parts[3] === "events" && parts.length === 4) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Canvas not found" }, 404);
      return sseResponse(canvas.id, request.signal, channels, sseIdleTimeoutMs);
    }
    if (method === "GET" && parts[1] === "canvases" && parts[2] && parts[3] === "assets" && parts.length === 4) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Canvas not found" }, 404);
      const entryNodeId = url.searchParams.get("entryNodeId");
      const assets = executionAssets(state.runs, {
        canvasId: canvas.id,
        executionId: url.searchParams.get("executionId"),
        nodeId: url.searchParams.get("producerNodeId"),
        kind: url.searchParams.get("kind")
      }).filter((asset) => !entryNodeId || asset.entryNodeId === entryNodeId);
      return json(paginateAssets(assets, url));
    }
    if (method === "GET" && parts[1] === "sessions" && parts[2] && parts[3] === "chat-history" && parts.length === 4) {
      const session = sessionById(parts[2]);
      return session ? json(session) : json({ error: "Session not found" }, 404);
    }
    if (method === "GET" && parts[1] === "sessions" && parts[2] && parts[3] === "turns" && parts.length === 4) {
      const session = sessionById(parts[2]);
      if (!session) return json({ error: "Session not found" }, 404);
      const statuses = new Set((url.searchParams.get("status") || "").split(",").filter(Boolean));
      return json(state.turns.filter((turn) => turn.sessionId === session.id && (!statuses.size || statuses.has(turn.status)) && !["succeeded", "failed", "cancelled", "cancelling"].includes(turn.status) && (activeTurnIds.has(turn.id) || turn.request)));
    }
    if (method === "POST" && parts[1] === "sessions" && parts[2] && parts[3] === "turns" && parts.length === 4) {
      const input = await parseJson(request);
      if (typeof input.message !== "string" || !input.message.trim()) return json({ error: "message is required" }, 400);
      if (!config.deepseek.apiKey) {
        const error = new Error("DeepSeek is not configured. Set DEEPSEEK_API_KEY and restart the API server.");
        error.statusCode = 503;
        throw error;
      }
      const session = sessionById(parts[2]);
      if (!session) return json({ error: "Session not found" }, 404);
      const canvas = canvasById(session.canvasId);
      if (!canvas) {
        const error = new Error("Canvas not found");
        error.statusCode = 404;
        throw error;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const turn = {
        id: `turn-${randomUUID()}`,
        sessionId: session.id,
        canvasId: canvas.id,
        message: input.message,
        attachments: Array.isArray(input.attachments) ? input.attachments : [],
        clientId: typeof input.clientId === "string" ? input.clientId : void 0,
        status: "queued",
        progress: [],
        createdAt: now,
        updatedAt: now
      };
      const trace = createAgentTrace(turn, { model: config.deepseek.model, runtime: config.agentServiceUrl ? "pi-service" : "direct" }, now);
      turn.traceId = trace.id;
      appendAgentTrace(trace, "turn_created", { message: turn.message }, now);
      appendAgentTrace(trace, "turn_queued", {}, now);
      state.turns.push(turn);
      state.agentTraces.push(trace);
      await store2.persist(["turns", "agentTraces"]);
      waitUntil(startAgentTurn(context2, turn));
      return json(turn, 202);
    }
    if (method === "POST" && parts[1] === "turns" && parts[3] === "continue" && parts.length === 4) {
      const turn = turnById(parts[2]);
      if (!turn) return json({ error: "Turn not found" }, 404);
      const input = await parseJson(request);
      if (!turn.request) {
        const session2 = sessionById(turn.sessionId);
        const requestMessage2 = session2?.messages.find((message) => message.turnId === turn.id && message.request && !message.selection);
        if (requestMessage2) {
          turn.request = structuredClone(requestMessage2.request);
          turn.requestMessageId = requestMessage2.id;
        }
      }
      const selectedOptionIds = input.selected_option_ids;
      const existingSelection = turn.selection;
      if (existingSelection) {
        if (input.request_id === existingSelection.request_id && Array.isArray(selectedOptionIds) && selectedOptionIds.length === existingSelection.selected_option_ids.length && selectedOptionIds.every((optionId, index) => optionId === existingSelection.selected_option_ids[index])) {
          return json(turn);
        }
        return json({ error: "This selection was already submitted" }, 409);
      }
      if (!turn.request || input.request_id !== turn.request.request_id || ["succeeded", "failed", "cancelled", "cancelling"].includes(turn.status)) return json({ error: "Turn is not waiting for this selection" }, 409);
      if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((optionId) => typeof optionId !== "string") || new Set(selectedOptionIds).size !== selectedOptionIds.length || selectedOptionIds.length < turn.request.min || selectedOptionIds.length > turn.request.max || selectedOptionIds.some((optionId) => !turn.request.options.some((option) => option.id === optionId))) {
        return json({ error: "Selected options are invalid" }, 400);
      }
      await store2.reload(AGENT_COLLECTIONS);
      const currentTurn = turnById(parts[2]);
      const session = currentTurn && sessionById(currentTurn.sessionId);
      if (!currentTurn || !session || !canvasById(currentTurn.canvasId)) return json({ error: "Turn not found" }, 404);
      if (!currentTurn.request || input.request_id !== currentTurn.request.request_id || ["succeeded", "failed", "cancelled", "cancelling"].includes(currentTurn.status)) return json({ error: "Turn is not waiting for this selection" }, 409);
      currentTurn.selection = { request_id: currentTurn.request.request_id, selected_option_ids: selectedOptionIds };
      const trace = state.agentTraces.find((item) => item.turnId === currentTurn.id);
      if (trace) appendAgentTrace(trace, "user_selection_received", currentTurn.selection);
      const requestMessage = session.messages.find((message) => message.id === currentTurn.requestMessageId);
      const selectedLabels = selectedOptionIds.map((optionId) => currentTurn.request.options.find((option) => option.id === optionId)?.label || optionId);
      if (requestMessage) {
        requestMessage.selection = currentTurn.selection;
        session.messages.push({ id: `msg-${randomUUID()}`, role: "user", content: selectedLabels.join(", "), turnId: currentTurn.id, selection: currentTurn.selection, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
        session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      currentTurn.status = "queued";
      currentTurn.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await store2.persist(["sessions", "turns", "agentTraces"]);
      waitUntil(enqueueAgentTurn(context2, currentTurn));
      return json(currentTurn, 202);
    }
    if (method === "POST" && parts[1] === "turns" && parts[3] === "cancel" && parts.length === 4) {
      await store2.reload(["turns"]);
      const turn = turnById(parts[2]);
      if (!turn || !canvasById(turn.canvasId)) return json({ error: "Turn not found" }, 404);
      if (["succeeded", "failed", "cancelled"].includes(turn.status)) return json(turn);
      turn.status = "cancelling";
      turn.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const trace = state.agentTraces.find((item) => item.turnId === turn.id);
      if (trace) appendAgentTrace(trace, "turn_cancel_requested");
      await store2.persist(["turns", "agentTraces"]);
      try {
        await activeTurnCancels.get(turn.id)?.();
      } catch (error) {
        turn.status = "running";
        turn.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await store2.persist(["turns"]);
        throw error;
      }
      turn.status = "cancelled";
      turn.completedAt = (/* @__PURE__ */ new Date()).toISOString();
      turn.updatedAt = turn.completedAt;
      if (trace) {
        trace.status = "cancelled";
        trace.completedAt = turn.completedAt;
        appendAgentTrace(trace, "turn_cancelled");
      }
      await store2.persist(["turns", "agentTraces"]);
      channels.broadcast(turn.canvasId, channels.event(turn, "finish", { finish_reason: "cancelled" }));
      return json(turn);
    }
    if (method === "GET" && parts[1] === "executions" && parts.length === 3) {
      const execution = ownedExecution(parts[2]);
      if (!execution) return json({ error: "Execution not found" }, 404);
      const before = JSON.stringify(execution);
      await syncExecutionWithTripo(execution, config.getTripoTask);
      const handedOff = Object.values(execution.nodeRuns || {}).some((nodeRun) => nodeRun.meshyHandedOff);
      if (handedOff) {
        await withMeshyPoll(execution.id, async () => {
          await store2.reload(["runs"]);
          const fresh = executionById(state.runs, execution.id);
          if (!fresh) return;
          const snapshot = JSON.stringify(fresh);
          await syncExecutionWithMeshy(fresh, config);
          if (config.resumeMeshyRuns) await resumeMeshyExecution(fresh, canvasById(fresh.canvasId), config.createMeshyProvider);
          if (JSON.stringify(fresh) !== snapshot) await settlePaidExecution(store2, fresh);
        });
      } else if (JSON.stringify(execution) !== before) {
        await settlePaidExecution(store2, execution);
      }
      return json(executionDto(executionById(state.runs, execution.id) || execution));
    }
    if (method === "GET" && parts[1] === "canvases" && parts[2] && parts[3] === "executions" && parts.length === 4) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Canvas not found" }, 404);
      const runs = state.runs.filter((run) => run.canvasId === canvas.id);
      const before = JSON.stringify(runs);
      await Promise.all(runs.map((run) => syncExecutionWithTripo(run, config.getTripoTask)));
      if (JSON.stringify(runs) !== before) {
        await Promise.all(runs.map((run) => settlePaidExecution(store2, run)));
      }
      return json(canvasExecutions(runs, canvas.id));
    }
    if (method === "GET" && parts[1] === "tripo" && parts[2] === "tasks" && parts[3] && parts[4] === "download" && parts.length === 5) {
      if (!config.getTripoTask) return json({ error: "Tripo is not configured." }, 503);
      const taskId = parts[3];
      const ownsTask = state.runs.some((run) => canvasById(run.canvasId) && Object.values(run.nodeRuns || {}).some((nodeRun) => nodeRun.tripoTaskId === taskId || nodeRun.output?.tripoTaskId === taskId));
      if (!ownsTask) return json({ error: "Tripo task not found" }, 404);
      const task = await config.getTripoTask(taskId);
      const downloadUrl = task?.output?.model_url;
      return downloadUrl ? new Response(null, { status: 302, headers: { location: downloadUrl, "cache-control": "no-store" } }) : json({ error: "Tripo task has no downloadable model" }, 404);
    }
    if (method === "POST" && parts[1] === "executions" && parts[2] && parts[3] === "cancel" && parts.length === 4) {
      const execution = ownedExecution(parts[2]);
      if (!execution) return json({ error: "Execution not found" }, 404);
      cancelExecution(execution);
      await settlePaidExecution(store2, execution);
      return json(executionDto(execution), 202);
    }
    if (method === "POST" && parts[1] === "canvases" && parts[2] && parts[3] === "nodes" && parts[4] && parts[5] === "executions" && parts.length === 6) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Canvas not found" }, 404);
      const node = canvas.nodes.find((candidate) => candidate.id === parts[4]);
      if (!node) return json({ error: "Node not found" }, 404);
      const { mode = "downstream" } = await parseJson(request);
      const execution = await startPaidExecution(context2, canvas, node, mode, resolveProviderFactory(config, canvas.provider));
      return json(executionDto(execution), 202);
    }
    if (method === "POST" && parts[1] === "projects" && parts[2] && parts[3] === "executions" && parts.length === 4) {
      const canvas = canvasById(parts[2]);
      if (!canvas) return json({ error: "Project not found" }, 404);
      const { entryNodeId, nodeIds, mode = "downstream", idempotencyKey, parameters } = await parseJson(request);
      const node = canvas.nodes.find((candidate) => candidate.id === entryNodeId);
      if (!node) return json({ error: "Entry node not found" }, 404);
      const enforceActiveTaskLimit = request.headers.get("x-micro-method") === "/tripo.agent.api.run.v1.RunService/CreateRun";
      const execution = await startPaidExecution(context2, canvas, node, mode, resolveProviderFactory(config, canvas.provider), { nodeIds, idempotencyKey, parameters, enforceActiveTaskLimit });
      return json(executionDto(execution), 202);
    }
    if (method === "POST" && parts[1] === "assets" && parts.length === 2) {
      if (!config.uploadAsset) return json({ error: "Asset uploads are unavailable" }, 503);
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length) return json({ error: "Asset file is empty" }, 400);
      if (bytes.byteLength > 100 * 1024 * 1024) return json({ error: "Asset file must be 100 MB or smaller" }, 413);
      const url2 = await config.uploadAsset(bytes, contentType, request.headers.get("x-file-name") || "");
      return json({ url: url2, contentType });
    }
    if (method === "GET" && parts[1] === "assets" && parts.length === 3) {
      const asset = config.readAsset ? await config.readAsset(parts[2]) : null;
      if (!asset) return json({ error: "Asset not found" }, 404);
      return new Response(asset.bytes, {
        headers: {
          "content-type": asset.contentType,
          "content-length": String(asset.bytes.byteLength),
          "cache-control": "public, max-age=31536000, immutable"
        }
      });
    }
    return json({ error: "Not found" }, 404);
  }
  return async function handle2(request, runtime = {}) {
    try {
      const { visitorId, isNew } = readVisitor(request);
      const context2 = await createContext(request, runtime);
      await recoverAgentTurns(context2.builtInConfig ? { ...context2, config: context2.builtInConfig } : context2);
      const response = await route(request, { ...context2, visitorId });
      if (isNew) response.headers.append("set-cookie", visitorCookie(visitorId, request));
      return response;
    } catch (error) {
      if (!error.statusCode) console.error(error);
      return json({ error: error.message, ...error.code ? { code: error.code } : {}, ...error.limit !== void 0 ? { limit: error.limit } : {}, ...error.activeTaskCount !== void 0 ? { activeTaskCount: error.activeTaskCount } : {} }, error.statusCode || 500);
    }
  };
}

// dsh-plugin/server-entry.ts
var store = await createSqliteStore();
var readAsset2 = store.readAsset || readAsset;
var uploadAsset = store.uploadAsset || persistUploadedAsset;
var createTripoProvider = createTripoRunner(process.env, { readAsset: readAsset2 });
var providerEnv = process.env.FORGE3D_USE_ENV_KEYS === "1" ? process.env : { ...process.env, MESHY_API_KEY: "", TRIPO_API_KEY: "" };
var createMeshyProvider = createMeshyRunner(providerEnv, { readLocal: createMeshyLocalReader(readAsset2) });
var submitMeshyTask = createMeshySubmitter(providerEnv);
var getMeshyTask = createMeshyTaskReader(providerEnv);
var getTripoTask = createTripoTaskReader();
var agentServiceUrl = process.env.AGENT_SERVICE_URL === "direct" ? "" : process.env.AGENT_SERVICE_URL || "http://127.0.0.1:8788/agent";
var context = {
  store: {
    state: store.state,
    persist: (collections2) => Promise.all(collections2.map(store.persist)),
    reload: (collections2) => Promise.all(collections2.map(store.reload)),
    removeCanvas: store.removeCanvas
  },
  config: {
    agentServiceUrl,
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL
    },
    createTripoProvider,
    createMeshyProvider,
    getMeshyTask,
    submitMeshyTask,
    getTripoTask,
    readAsset: readAsset2,
    uploadAsset
  },
  waitUntil: (promise) => void Promise.resolve(promise).catch(() => {
  }),
  recoverAgentTurns: true
};
var configuredSseIdleTimeout = Number(process.env.SSE_IDLE_TIMEOUT_MS);
var handle = createApi({
  createContext: (request) => {
    const config = applyUserKeys(context.config, readUserKeys(request), (apiKey) => {
      const keyed = { ...process.env, MESHY_API_KEY: apiKey };
      return {
        createMeshyProvider: createMeshyRunner(keyed, { readLocal: createMeshyLocalReader(readAsset2) }),
        getMeshyTask: createMeshyTaskReader(keyed),
        submitMeshyTask: createMeshySubmitter(keyed)
      };
    });
    return config === context.config ? context : { ...context, config, builtInConfig: context.config };
  },
  ...Number.isFinite(configuredSseIdleTimeout) && configuredSseIdleTimeout > 0 ? { sseIdleTimeoutMs: configuredSseIdleTimeout } : {}
});
async function toRequest(request) {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  const hasBody = !["GET", "HEAD"].includes(request.method);
  let body;
  if (hasBody) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = chunks.length ? Buffer.concat(chunks) : void 0;
  }
  const controller = new AbortController();
  request.on("close", () => controller.abort());
  return new Request(url, {
    method: request.method,
    headers: Object.entries(request.headers).filter(([, value]) => value !== void 0).map(([name, value]) => [name, String(value)]),
    body,
    signal: controller.signal
  });
}
async function seedIfEmpty(cookie) {
  const list = await handle(new Request("http://127.0.0.1/api/projects", { headers: { cookie } }));
  const rows = await list.json();
  if (Array.isArray(rows) && rows.length > 0) return false;
  const starter = starterCanvasGraph();
  const created = await handle(new Request("http://127.0.0.1/api/projects", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "My first 3D canvas",
      description: "A ready-to-customize 3D production canvas.",
      provider: "meshy",
      nodes: starter.nodes,
      edges: starter.edges,
      viewport: starterCanvasViewport
    })
  }));
  return created.ok;
}
async function handleNodeRequest(request, response) {
  try {
    const result = await handle(await toRequest(request));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    if (!result.body) return response.end();
    const reader = result.body.getReader();
    try {
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) break;
        response.write(value);
      }
    } catch {
    }
    response.end();
  } catch (error) {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}
export {
  buildCanvasStructure,
  canvasNodeTypes,
  describeCanvasParameters,
  handleNodeRequest,
  removeCanvasNodes,
  seedIfEmpty,
  handle as serveRequest,
  updateNodeParameters
};
