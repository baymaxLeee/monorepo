package main

import (
	"github.com/example/monorepo/dbmigrate"
	conversion "github.com/example/monorepo/dbmigrate/internal/testfixture/migrations/v1.0.1"
)

func main() {
	dbmigrate.Main(map[string]dbmigrate.GoMigration{"v1.0.1.0": {Up: conversion.Up, Down: conversion.Down, Source: conversion.Source}})
}
