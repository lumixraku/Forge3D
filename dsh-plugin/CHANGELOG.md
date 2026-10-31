# Changelog

## 0.1.0 — first release

The canvas as a conversation tab: a node graph for 3D asset work that the
harness agent can read and edit while the user runs it.

**Canvas**

- `conversation.view` tab rendering the Forge3D canvas as a native React
  component; the app's own copilot, editor stack and agent column are compiled
  out of this build.
- `/forge3d/api` served in-process by the host, so there is no second service and
  no port of its own.
- Canvases persist to a SQLite file under the DSH state directory, seeded with a
  starter workflow on first run.

**Agent tools**

- `forge3d_canvas_list`, `forge3d_canvas_read`, `forge3d_node_types`,
  `forge3d_describe_node`, `forge3d_canvas_build`, `forge3d_canvas_update`,
  `forge3d_canvas_delete`.
- A `forge3d:canvas` system-prompt section tells the model that the tab exists,
  which canvas a call touches by default, and that these tools edit the graph
  rather than execute it.
- Tools append stages to a frame, connect compatible ports, and repair the graph
  around a deleted stage.

**Model viewer**

- Real three.js viewer in the model editor, with load progress reported from the
  response size; asset reads answer `Cache-Control: no-transform` and carry
  `x-file-size` so a compressing host cannot hide the total.
- Model editor opens as an overlay on the canvas panel.

**Keys**

- Keys typed into the dialog travel as headers and cookies for that request only;
  they are never stored by the server.
- The plugin never spends a checkout's `.env` keys — only the visitor's own —
  and a cleared key stops the next run instead of being resurrected from memory.

**Known limits**

- The agent edits the graph but never runs it; a run is the user's click on a
  node's Run button.
- `/forge3d` does not implement the host's authentication; it is reachable from
  anything that can reach the loopback port.
