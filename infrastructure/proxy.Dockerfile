FROM caddy:2-alpine@sha256:881bbc60f9986d5ab8e7cfd6cf7e4ef3c9c0439fef2429d035d065577882f028
# The Go proxy is statically linked. Keep its TLS trust store, remove unused tools,
# and run without a file capability or root user. Compose permits low ports only
# inside this container's own network namespace.
RUN setcap -r /usr/bin/caddy \
    && addgroup -S -g 10001 still-proxy \
    && adduser -S -D -H -u 10001 -G still-proxy still-proxy \
    && chown -R still-proxy:still-proxy /data /config \
    && apk add --no-network ca-certificates-bundle \
    && apk del --no-network curl libcap apk-tools zlib
USER 10001:10001
