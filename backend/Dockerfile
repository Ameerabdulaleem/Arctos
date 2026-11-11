# Build
FROM rust:1-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# Run
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 arctos
COPY --from=build /app/target/release/arctos-backend /usr/local/bin/arctos-backend
USER arctos
ENV HOST=0.0.0.0 PORT=4000 RUST_LOG=arctos_backend=info
EXPOSE 4000
CMD ["arctos-backend"]
