function getRuntime(memory) {
  const abort = () => { throw new WebAssembly.RuntimeError("ABRT") };
  return {
    imports: {
      env: {
        abort,
        emscripten_notify_memory_growth(_m) { /* We just don't hold references to memory */ },
      },
      wasi_snapshot_preview1: {
        proc_exit: abort,
        fd_close: abort,
        fd_seek: abort,
        fd_write: abort,
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
    this.ref = 0;
    this.lastFrameRef = 0;
  }
  _init() {
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
    new Uint8Array(this.FFI.memory.buffer).set(obu, obuRef);
    // const frameRef = this.FFI.k(this.ref, obuRef, obu.byteLength, format);
    const frameRef = this.FFI.djs_decode_obu(this.ref, obuRef, obu.byteLength, format);
    if (!frameRef) {
      this.FFI.djs_free_obu(obuRef);
      throw new Error("error in djs_decode_obu");
    }
    const frameInfo = new Uint32Array(this.FFI.memory.buffer, frameRef, 4);
    const width = frameInfo[0];
    const height = frameInfo[1];
    const size = frameInfo[2];
    const dataRef = frameInfo[3];
    const srcData = new Uint8Array(this.FFI.memory.buffer, dataRef, size);
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
