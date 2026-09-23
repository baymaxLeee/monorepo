import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { BaseBuilder, createBaseBuilderConfig, type WorkflowManifest } from "@workflow/builders";

class DevelopmentBuilder extends BaseBuilder {
  readonly #outputDirectory: string;

  constructor(workingDirectory: string) {
    super({
      ...createBaseBuilderConfig({
        workingDir: workingDirectory,
        watch: false,
        dirs: ["."],
      }),
      buildTarget: "standalone",
    });
    this.#outputDirectory = resolve(workingDirectory, "node_modules/.workflow-dev");
  }

  async build(): Promise<void> {
    const inputFiles = await this.getInputFiles();
    const tsconfigPath = await this.findTsConfigPath();
    await mkdir(this.#outputDirectory, { recursive: true });

    const { manifest: workflows, interimBundleCtx } = await this.createWorkflowsBundle({
      outfile: resolve(this.#outputDirectory, "workflows.mjs"),
      bundleFinalOutput: false,
      format: "esm",
      inputFiles,
      tsconfigPath,
    });
    const { manifest: steps, context: stepsContext } = await this.createStepsBundle({
      outfile: resolve(this.#outputDirectory, "steps.mjs"),
      externalizeNonSteps: true,
      bundleTransitiveLocalStepDependencies: true,
      format: "esm",
      inputFiles,
      tsconfigPath,
    });
    await Promise.all([stepsContext?.dispose(), interimBundleCtx?.dispose()]);
    await this.createWebhookBundle({
      outfile: resolve(this.#outputDirectory, "webhook.mjs"),
      bundle: false,
    });

    const manifest: WorkflowManifest = {
      steps: { ...steps.steps, ...workflows.steps },
      workflows: { ...steps.workflows, ...workflows.workflows },
      classes: { ...steps.classes, ...workflows.classes },
    };
    await this.createManifest({
      workflowBundlePath: resolve(this.#outputDirectory, "workflows.mjs"),
      manifestDir: this.#outputDirectory,
      manifest,
    });
  }
}

await new DevelopmentBuilder(process.cwd()).build();
