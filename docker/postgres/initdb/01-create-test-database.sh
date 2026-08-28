#!/bin/sh
# Runs only when PostgreSQL initializes a fresh data directory.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE DATABASE "$POSTGRES_TEST_DB" OWNER "$POSTGRES_USER";
SQL

echo "created test database: $POSTGRES_TEST_DB"
