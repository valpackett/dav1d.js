all: dav1d.wasm

patch:
	# patch -d dav1d -p1 <dav1d.patch

build/dist/lib/libdav1d.a:
	podman run --rm -it -v $(CURDIR):/src emscripten/emsdk sh -c "apt update && apt install -y meson && meson dav1d build --prefix=/src/build/dist --cross-file=dav1d/package/crossfiles/wasm32.meson --default-library=static --buildtype=debugoptimized -Dbitdepths=\"['8']\" -Denable_tools=false -Denable_tests=false -Dlogging=false && ninja -C build install"

dav1d.wasm: build/dist/lib/libdav1d.a dav1d.c
	podman run --rm -it -v $(CURDIR):/src emscripten/emsdk emcc $^ -DNDEBUG -O3 -flto --no-entry -Ibuild/dist/include -o $@ \
		-s MALLOC=emmalloc -s INITIAL_MEMORY=8MB -s STACK_SIZE=4MB -s ALLOW_MEMORY_GROWTH=1

.PHONY: test
test: dav1d.c
	$(CC) $^ $(CFLAGS) -O2 -g -Wall -fsanitize=address -o $@ \
		`pkg-config --libs --cflags dav1d` -lpthread

test-native: test
	./test

test-valgrind: CFLAGS = -DDJS_VALGRIND
test-valgrind: test
	valgrind ./test

test-node: dav1d.wasm
	node --experimental-modules --preserve-symlinks test.mjs

clean: clean-build clean-wasm clean-test
clean-build:
	rm -rf build
clean-wasm:
	rm -f dav1d.wasm
clean-test:
	rm -f test
