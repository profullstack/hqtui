package main

import (
	"github.com/profullstack/hqtui/ports/go/internal/demo"
	"os"
)

func main() { os.Exit(demo.Main(os.Args[1:])) }
