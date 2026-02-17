package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var content embed.FS

// DistFS returns the embedded filesystem for the frontend, rooted at "dist".
func DistFS() (fs.FS, error) {
	return fs.Sub(content, "dist")
}
