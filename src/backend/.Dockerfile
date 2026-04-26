# Stage 1: Build the binary
FROM golang:1.24-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy go mod and sum files to cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the application
# CGO_ENABLED=0 ensures a static binary for alpine
RUN CGO_ENABLED=0 GOOS=linux go build -o main ./main.go

# Stage 2: Run the binary
FROM alpine:latest  

RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the binary from the builder stage
COPY --with=builder /app/main .
# Copy .env file if your app uses one (ensure it's in your .dockerignore)
# COPY --from=builder /app/.env . 

# Expose the port your app runs on (e.g., 8080)
EXPOSE 8080

# Command to run the executable
CMD ["./main"]