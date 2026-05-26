import TiptapTextAlign from "@tiptap/extension-text-align";

const textAlignTypes = ["heading", "paragraph", "listItem", "taskItem"];

export const createTextAlignExtension = () =>
  TiptapTextAlign.configure({
    types: textAlignTypes,
  }).extend({
    addGlobalAttributes() {
      const parentAttributes = this.parent?.() ?? [];

      return parentAttributes.map((config) => {
        const textAlignAttribute = config.attributes?.textAlign;
        if (!textAlignAttribute) return config;

        const originalRenderHTML = textAlignAttribute.renderHTML;
        return {
          ...config,
          attributes: {
            ...config.attributes,
            textAlign: {
              ...textAlignAttribute,
              renderHTML: (attributes: Record<string, any>) => {
                const rendered =
                  originalRenderHTML?.(attributes) ??
                  ({} as Record<string, any>);
                const textAlign = attributes.textAlign;

                if (typeof textAlign === "string" && textAlign.length > 0) {
                  return {
                    ...rendered,
                    "data-text-align": textAlign,
                  };
                }

                return rendered;
              },
            },
          },
        };
      });
    },
  });
