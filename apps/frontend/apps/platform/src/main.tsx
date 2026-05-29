// MF async boundary: defer startup to ./bootstrap so the shared scope inits
// before any shared dep (React/Router/Zustand/runtime) is consumed.
import("./bootstrap");
