package aigw

// storyboardWorkerConcurrency bounds the fan-out inside one Storyboard task.
// Pod-wide AIGW admission is enforced separately by platform/aigwproxy.
const storyboardWorkerConcurrency = 8
