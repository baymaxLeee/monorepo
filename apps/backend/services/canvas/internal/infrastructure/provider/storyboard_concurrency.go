package provider

// storyboardWorkerConcurrency bounds the fan-out inside one Storyboard task.
// Pod-wide provider admission is enforced by the caller.
const storyboardWorkerConcurrency = 8
