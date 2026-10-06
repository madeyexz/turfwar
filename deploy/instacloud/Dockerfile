# The game's SpacetimeDB server on InstaCloud (Singapore). The official image carries a full Rust and
# .NET toolchain (several GB); only its two server binaries are needed, so they are copied onto a
# slim Debian (the same glibc as the image's build) to keep cold starts quick.
FROM clockworklabs/spacetime:v2.10.2 AS stdb

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*
COPY --from=stdb /opt/spacetime /opt/spacetime
RUN ln -s /opt/spacetime/spacetimedb-cli /usr/local/bin/spacetime
COPY config.toml prune-commitlog.sh start.sh /opt/turfwar/
RUN chmod 755 /opt/turfwar/*.sh
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/opt/turfwar/start.sh"]
