/**
 * Compositing hints for the `ambient` effect: `will-change: transform` on the
 * layers that move or blur, `contain: paint` on the effect's layer. They ask
 * the browser to keep those layers on the GPU between frames.
 *
 * On everywhere. Their effect depends on the machine: on the one measured (Apple M1 Pro, Chrome) they
 * changed nothing measurable, and the cost of keeping 3 to 4 layers in GPU
 * memory is not measured. Set this to `false` to take them all out at once.
 */
export const COMPOSITOR_HINTS: boolean = true;
