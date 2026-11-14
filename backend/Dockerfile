# Build
# TLS is pure Rust (rustls), so no OpenSSL packages are needed in either stage.
FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# Run
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 arctos
COPY --from=build /app/target/release/arctos-backend /usr/local/bin/arctos-backend
USER arctos
ENV HOST=0.0.0.0 PORT=4000 RUST_LOG=arctos_backend=info
EXPOSE 4000
CMD ["arctos-backend"]
