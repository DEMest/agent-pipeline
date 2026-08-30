FROM golang:1.23-alpine AS build
WORKDIR /src
# Сначала только манифесты модулей: слой с зависимостями переиспользуется,
# пока go.mod и go.sum не менялись.
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
# CGO выключен, чтобы получился статический бинарник: он запускается в образе
# без libc. -trimpath и -ldflags убирают пути сборочной машины и отладочные
# таблицы, уменьшая образ и не раскрывая структуру каталогов сборки.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

# distroless не содержит ни оболочки, ни пакетного менеджера: в образе остаётся
# только бинарник, поэтому эксплуатировать в нём буквально нечего.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
