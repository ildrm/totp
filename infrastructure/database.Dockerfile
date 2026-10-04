FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 AS compression-build
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
    && apk --timeout 30 add --no-cache build-base
ADD --checksum=sha256:03a76732cfaa124c58b67600699d935d081604385c03aa282f81a101b7536161 https://codeload.github.com/madler/zlib/tar.gz/df84af25dc1942490e1d1c899a07619152a46148 /source.tar.gz
WORKDIR /source
RUN tar -xzf /source.tar.gz --strip-components=1 \
    && CFLAGS="-O2 -fPIC -D_FORTIFY_SOURCE=2 -fstack-protector-strong" LDFLAGS="-Wl,-z,relro,-z,now" ./configure --prefix=/usr \
    && make -j2 \
    && make test \
    && mkdir -p /package/usr/lib /package/usr/share/licenses/zlib \
    && cp -a libz.so* /package/usr/lib/ \
    && cp README /package/usr/share/licenses/zlib/README \
    && apk mkpkg --info name:zlib --info version:1.3.2.1-r0 \
       --info arch:$(apk --print-arch) --info license:Zlib \
       --info description:"Upstream 1.3.2.1-motley snapshot with CVE-2026-85091 fix" \
       --info origin:zlib --info url:https://github.com/madler/zlib \
       --info depends:musl --info provides:so:libz.so.1=1.3.2.1 \
       --files /package --output /zlib-fixed.apk

FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 AS runtime
LABEL org.still.zlib.source="https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148" \
      org.still.zlib.archive-sha256="03a76732cfaa124c58b67600699d935d081604385c03aa282f81a101b7536161" \
      org.still.zlib.upstream-version="1.3.2.1-motley"
COPY --from=compression-build /zlib-fixed.apk /tmp/zlib-fixed.apk
# This is a locally built package from the checksum-pinned upstream snapshot,
# not a claim that Alpine has published a patched distribution package.
RUN apk add --no-network ca-certificates-bundle \
    && apk add --no-network --allow-untrusted /tmp/zlib-fixed.apk \
    && rm /tmp/zlib-fixed.apk \
    && apk del --no-network apk-tools
