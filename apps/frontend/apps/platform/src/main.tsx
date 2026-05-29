/**
 * Module Federation host entry.
 *
 * Keep this file side-effect-light: the single dynamic import below is the
 * async boundary that lets the shared scope initialize before any shared
 * dependency (React, Router, Zustand, platform runtime) is consumed. All real
 * startup logic lives in `./bootstrap`.
 */
import("./bootstrap");
