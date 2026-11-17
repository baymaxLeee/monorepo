#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: registry-login.sh <registry> <username>" >&2
  exit 2
fi

registry="$1"
username="$2"
attempts="${REGISTRY_LOGIN_ATTEMPTS:-5}"
delay_seconds="${REGISTRY_LOGIN_INITIAL_DELAY_SECONDS:-2}"

if [[ ! "${attempts}" =~ ^[1-9][0-9]*$ ]] || [[ ! "${delay_seconds}" =~ ^[0-9]+$ ]]; then
  echo "registry login retry settings must be non-negative integers, with at least one attempt" >&2
  exit 2
fi

IFS= read -r password
if [[ -z "${password}" ]]; then
  echo "registry password is required on standard input" >&2
  exit 2
fi

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  if printf '%s\n' "${password}" | docker login "${registry}" --username "${username}" --password-stdin; then
    exit 0
  fi
  if ((attempt == attempts)); then
    echo "registry login failed after ${attempts} attempts" >&2
    exit 1
  fi
  echo "registry login attempt ${attempt}/${attempts} failed; retrying in ${delay_seconds}s" >&2
  sleep "${delay_seconds}"
  delay_seconds=$((delay_seconds * 2))
done
