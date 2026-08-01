# Ghostty cursor shaders

Bundled from
[`sahaj-b/ghostty-cursor-shaders`](https://github.com/sahaj-b/ghostty-cursor-shaders)
at commit `0a274beac8b93ee6ce6b94402b7313a0417b8e38`.

The files are loaded only through Vimeflow's allowlisted cursor-effect presets.
Vimeflow tunes the effects to show one-cell terminal cursor moves. Boom and
ripple presets also use the active cursor color and react to movement in
addition to upstream's cursor-shape-change trigger. Tail stays visible for
0.16 seconds; upstream requires larger jumps and fades after 0.09 seconds.
See `LICENSE` for the upstream MIT license.
