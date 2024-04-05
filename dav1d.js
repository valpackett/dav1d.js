function abort(what) {
  what = "Aborted(" + what + ")";
  console.error(what);
  throw new WebAssembly.RuntimeError(what);
}

let HEAPU8;
function getRuntime(memory) {
  const _abort = () => abort("");
  const _emscripten_get_heap_max = () => HEAPU8.length;
  const _emscripten_memcpy_js = (dest, src, num) =>
    HEAPU8.copyWithin(dest, src, src + num);
  const _emscripten_resize_heap = (requestedSize) => abort("OOM");
  return {
    imports: {
      // a: {
      //   a: _abort,
      //   d: _emscripten_get_heap_max,
      //   b: _emscripten_memcpy_js,
      //   c: _emscripten_resize_heap,
      // }
      env: {
        __assert_fail: () => abort("assert"),
        abort: _abort,
        emscripten_get_heap_max: _emscripten_get_heap_max,
        emscripten_memcpy_js: _emscripten_memcpy_js,
        emscripten_resize_heap: _emscripten_resize_heap,
      },
      wasi_snapshot_preview1: {
        proc_exit: () => abort("exit"),
        fd_close: () => abort("fd"),
        fd_seek: () => abort("fd"),
        fd_write: () => abort("fd")
      },
    },
  };
}

function fetchAndInstantiate(data, url, imports) {
  if (data) return WebAssembly.instantiate(data, imports);
  const req = fetch(url, {credentials: "same-origin"});
  if (WebAssembly.instantiateStreaming) {
    return WebAssembly.instantiateStreaming(req, imports);
  } else {
    return req
      .then(res => res.arrayBuffer())
      .then(data => WebAssembly.instantiate(data, imports));
  }
}

export function create(opts = {}) {
  if (!opts.wasmURL && !opts.wasmData) {
    return Promise.reject(new Error("Either wasmURL or wasmData shall be provided"));
  }
  const { imports } = getRuntime();
  return fetchAndInstantiate(opts.wasmData, opts.wasmURL, imports).then(wasm => {
    const d = new Dav1d({wasm});
    d._init();
    return d;
  });
}

const DJS_FORMAT_YUV = 0;
const DJS_FORMAT_BMP = 1;

class Dav1d {
  /* Private methods, shall not be used */

  constructor({wasm}) {
    this.FFI = wasm.instance.exports;
    this.buffer = this.FFI.memory.buffer;
    this.HEAPU8 = HEAPU8 = new Uint8Array(this.buffer);
    this.ref = 0;
    this.lastFrameRef = 0;
  }
  _init() {
    console.log(this.FFI)
    this.FFI._initialize()
    // this.ref = this.FFI.g();
    this.ref = this.FFI.djs_init();
    if (!this.ref) throw new Error("error in djs_init");
  }
  _decodeFrame(obu, format, unsafe) {
    if (!ArrayBuffer.isView(obu)) {
      obu = new Uint8Array(obu);
    }
    // const obuRef = this.FFI.j(obu.byteLength);
    const obuRef = this.FFI.djs_alloc_obu(obu.byteLength);
    if (!obuRef) throw new Error("error in djs_alloc_obu");
    this.HEAPU8.set(obu, obuRef);
    // const frameRef = this.FFI.k(this.ref, obuRef, obu.byteLength, format);
    console.log('decoding', obu.byteLength, format)
    const frameRef = this.FFI.djs_decode_obu(this.ref, obuRef, obu.byteLength, format);
    if (!frameRef) throw new Error("error in djs_decode_obu");
    const frameInfo = new Uint32Array(this.buffer, frameRef, 4);
    const width = frameInfo[0];
    const height = frameInfo[1];
    const size = frameInfo[2];
    const dataRef = frameInfo[3];
    const srcData = new Uint8Array(this.buffer, dataRef, size);
    if (unsafe) {
      this.lastFrameRef = frameRef;
      return srcData;
    }
    const data = new Uint8Array(size);
    data.set(srcData);
    // this.FFI.l(frameRef);
    this.FFI.djs_free_frame(frameRef);
    return {width, height, data};
  }

  /* Public API methods */

  /**
   * Frame decoding, copy of frame data is returned.
   */
  decodeFrameAsYUV(obu) {
    return this._decodeFrame(obu, DJS_FORMAT_YUV, false);
  }
  decodeFrameAsBMP(obu) {
    return this._decodeFrame(obu, DJS_FORMAT_BMP, false);
  }

  /**
   * Unsafe decoding with minimal overhead, pointer to WebAssembly
   * memory is returned. User can't call any dav1d.js methods while
   * keeping reference to it and shall call `unsafeCleanup` when
   * finished using the data.
   */
  unsafeDecodeFrameAsYUV(obu) {
    return this._decodeFrame(obu, DJS_FORMAT_YUV, true);
  }
  unsafeDecodeFrameAsBMP(obu) {
    return this._decodeFrame(obu, DJS_FORMAT_BMP, true);
  }
  unsafeCleanup() {
    if (this.lastFrameRef) {
      // this.FFI.l(this.lastFrameRef);
      this.FFI.djs_free_frame(this.lastFrameRef);
      this.lastFrameRef = 0;
    }
  }
}

export default {create};
