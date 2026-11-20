/**
 * Reduces a frame to `width`×`height` on the GPU and reads only that: on a 4K
 * frame it costs 1-3 ms where `drawImage` + `getImageData` cost 14 ms on Chrome
 * and 33 ms on Safari. The colors differ a little from the canvas path (up to
 * ~10/255 measured on Safari), which is left uncorrected. Works in a Worker;
 * throws if anything goes wrong.
 */

const VERTEX = `#version 300 es
in vec2 p;out vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0,1);}`;
const FRAGMENT = `#version 300 es
precision mediump float;in vec2 uv;uniform sampler2D t;out vec4 o;void main(){o=texture(t,uv);}`;

export type GlReader = (frame: VideoFrame) => Uint8ClampedArray;

export function createGlReader(
  width: number,
  height: number
): GlReader | undefined {
  if (typeof OffscreenCanvas === "undefined") {
    return;
  }
  const context = new OffscreenCanvas(width, height).getContext("webgl2", {
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!context) {
    return;
  }

  const compile = (type: number, source: string) => {
    const shader = context.createShader(type);
    if (!shader) {
      throw new Error("webgl shader unavailable");
    }
    context.shaderSource(shader, source);
    context.compileShader(shader);
    return shader;
  };
  const program = context.createProgram();
  context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX));
  context.attachShader(program, compile(context.FRAGMENT_SHADER, FRAGMENT));
  context.linkProgram(program);
  context.useProgram(program);

  context.bindBuffer(context.ARRAY_BUFFER, context.createBuffer());
  context.bufferData(
    context.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    context.STATIC_DRAW
  );
  const position = context.getAttribLocation(program, "p");
  context.enableVertexAttribArray(position);
  context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);

  context.bindTexture(context.TEXTURE_2D, context.createTexture());
  // Mipmaps do the averaging: sampling a 4K texture at 256×144 would alias.
  context.texParameteri(
    context.TEXTURE_2D,
    context.TEXTURE_MIN_FILTER,
    context.LINEAR_MIPMAP_LINEAR
  );
  context.texParameteri(
    context.TEXTURE_2D,
    context.TEXTURE_MAG_FILTER,
    context.LINEAR
  );
  context.texParameteri(
    context.TEXTURE_2D,
    context.TEXTURE_WRAP_S,
    context.CLAMP_TO_EDGE
  );
  context.texParameteri(
    context.TEXTURE_2D,
    context.TEXTURE_WRAP_T,
    context.CLAMP_TO_EDGE
  );
  context.viewport(0, 0, width, height);

  const bytes = new Uint8Array(width * height * 4);
  const pixels = new Uint8ClampedArray(bytes.buffer);

  return (frame) => {
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      context.RGBA,
      context.UNSIGNED_BYTE,
      frame
    );
    context.generateMipmap(context.TEXTURE_2D);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    context.readPixels(
      0,
      0,
      width,
      height,
      context.RGBA,
      context.UNSIGNED_BYTE,
      bytes
    );
    const code = context.getError();
    if (code !== context.NO_ERROR || context.isContextLost()) {
      throw new Error(`webgl error 0x${code.toString(16)}`);
    }
    return pixels;
  };
}
