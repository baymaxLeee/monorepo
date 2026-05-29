import JSZip from "jszip";
// biome-ignore lint/suspicious/noTsIgnore: 上游包元数据缺失
// @ts-ignore
import * as mindMapUtils from "simple-mind-map/src/utils/index";
// biome-ignore lint/suspicious/noTsIgnore: 上游包元数据缺失
// @ts-ignore
import * as xmindUtils from "simple-mind-map/src/utils/xmind";
import xmlConvert from "xml-js";

const { getTextFromHtml, isUndef } = mindMapUtils as {
  getTextFromHtml: (value: string) => string;
  isUndef: (value: unknown) => boolean;
};

const {
  addSummaryData,
  getItemByName,
  getRoot,
  getSummaryText,
  getSummaryText2,
  getXmindContentXmlData,
  handleNodeImageFromXmind,
  handleNodeImageToXmind,
  parseNodeGeneralizationToXmind,
} = xmindUtils as Record<string, any>;

type AnyRecord = Record<string, any>;

const getSafeElementsByType = (arr: any, type: string) => {
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr.reduce((list, item) => {
    if (item?.attributes?.type === type && Array.isArray(item.elements)) {
      list.push(...item.elements);
    }
    return list;
  }, [] as AnyRecord[]);
};

const getOldTopicChildren = (childrenItem: any) => {
  if (!childrenItem?.elements) {
    return [];
  }
  return [
    ...getSafeElementsByType(childrenItem.elements, "attached"),
    ...getSafeElementsByType(childrenItem.elements, "detached"),
  ];
};

const getXmindTopicChildren = (children?: AnyRecord) => {
  if (!children) {
    return [];
  }
  return [
    ...(Array.isArray(children.detached) ? children.detached : []),
    ...(Array.isArray(children.attached) ? children.attached : []),
  ];
};

const getFirstItemByName = (
  items: any,
  name: string,
): AnyRecord | undefined => {
  if (!Array.isArray(items)) {
    return undefined;
  }
  for (const item of items) {
    if (item?.name === name) {
      return item;
    }
    const matched = getFirstItemByName(item?.elements, name);
    if (matched) {
      return matched;
    }
  }
  return undefined;
};

const getOldTopicTitle = (node: AnyRecord) => {
  const titleItem = getItemByName(node.elements || [], "title");
  return titleItem?.elements?.[0]?.text;
};

const getOldTopicImage = (node: AnyRecord) => {
  return (node.elements || []).find(
    (item: AnyRecord) => item.name === "xhtml:img",
  );
};

const getImageTypeFromPath = (path: string) => {
  return /\.([^.]+)$/.exec(path)?.[1] || "png";
};

const handleOldNodeImageFromXmind = async (
  node: AnyRecord,
  newNode: AnyRecord,
  promiseList: Promise<any>[],
  files: AnyRecord,
) => {
  const image = getOldTopicImage(node);
  const imageSrc = image?.attributes?.["xhtml:src"];
  if (!imageSrc || !/^xap:attachments\//.test(imageSrc)) {
    return;
  }

  const promise = (async () => {
    try {
      const imagePath = imageSrc.replace(/^xap:/, "");
      const imageFile = files[imagePath];
      if (!imageFile) {
        return;
      }
      const imageType = getImageTypeFromPath(imagePath);
      newNode.data.image = `data:image/${imageType};base64,${await imageFile.async(
        "base64",
      )}`;
      newNode.data.imageSize = {
        width: Number(image.attributes?.["svg:width"]) || 0,
        height: Number(image.attributes?.["svg:height"]) || 0,
      };
    } catch (error) {
      console.error(error);
    }
  })();
  promiseList.push(promise);
};

const getSafeSummaryText2 = (item: any, topicId: string) => {
  if (!item?.elements) {
    return "";
  }
  try {
    return getSummaryText2(item, topicId);
  } catch (error) {
    console.error(error);
    return "";
  }
};

const parseXmindFile = (file: Blob, handleMultiCanvas?: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    JSZip.loadAsync(file).then(
      async (zip: any) => {
        try {
          let content: any = "";
          const jsonFile = zip.files["content.json"];
          const xmlFile = zip.files["content.xml"] || zip.files["/content.xml"];
          if (jsonFile) {
            const json = await jsonFile.async("string");
            content = await transformXmind(json, zip.files, handleMultiCanvas);
          } else if (xmlFile) {
            const xml = await xmlFile.async("string");
            const json = xmlConvert.xml2json(xml);
            content = await transformOldXmind(json, zip.files);
          }
          if (content) {
            resolve(content);
          } else {
            reject(new Error("解析失败"));
          }
        } catch (error) {
          reject(error);
        }
      },
      (e: Error) => {
        reject(e);
      },
    );
  });
};

const transformXmind = async (
  content: string,
  files: AnyRecord,
  handleMultiCanvas?: any,
): Promise<AnyRecord> => {
  const xmindContent = JSON.parse(content);
  let data: any = null;
  if (xmindContent.length > 1 && typeof handleMultiCanvas === "function") {
    data = await handleMultiCanvas(xmindContent);
  }
  if (!data) {
    data = xmindContent[0];
  }
  const nodeTree = data.rootTopic;
  const newTree: AnyRecord = {};
  const waitLoadImageList: Promise<any>[] = [];
  const walk = async (node: AnyRecord, newNode: AnyRecord) => {
    newNode.data = {
      text: isUndef(node.title) ? "" : node.title,
    };
    if (node.notes) {
      const notesData = node.notes.realHTML || node.notes.plain;
      newNode.data.note = notesData ? notesData.content || "" : "";
    }
    if (node.href && /^https?:\/\//.test(node.href)) {
      newNode.data.hyperlink = node.href;
    }
    if (node.labels && node.labels.length > 0) {
      newNode.data.tag = node.labels;
    }
    handleNodeImageFromXmind(node, newNode, waitLoadImageList, files);
    const selfSummary: any[] = [];
    const childrenSummary: any[] = [];
    if (newNode._summary) {
      selfSummary.push(newNode._summary);
    }
    if (Array.isArray(node.summaries) && node.summaries.length > 0) {
      node.summaries.forEach((item: AnyRecord) => {
        addSummaryData(
          selfSummary,
          childrenSummary,
          () => {
            return getSummaryText(node, item.topicId);
          },
          item.range,
        );
      });
    }
    newNode.data.generalization = selfSummary;
    newNode.children = [];
    const children = getXmindTopicChildren(node.children);
    if (children.length > 0) {
      children.forEach((item: AnyRecord, index: number) => {
        const newChild: AnyRecord = {};
        newNode.children.push(newChild);
        if (childrenSummary[index]) {
          newChild._summary = childrenSummary[index];
        }
        walk(item, newChild);
      });
    }
  };
  walk(nodeTree, newTree);
  await Promise.all(waitLoadImageList);
  return newTree;
};

const transformOldXmind = async (
  content: string,
  files: AnyRecord,
): Promise<AnyRecord> => {
  const data = JSON.parse(content);
  const elements = data.elements;
  const root = getRoot(elements);
  const sheet = getFirstItemByName(elements, "sheet");
  const sheetTitle = getOldTopicTitle(sheet || {});
  const newTree: AnyRecord = {};
  const waitLoadImageList: Promise<any>[] = [];
  const walk = (node: AnyRecord, newNode: AnyRecord, isRoot?: boolean) => {
    const nodeElements = node.elements;
    const nodeTitle = getOldTopicTitle(node);
    newNode.data = {
      text: isUndef(nodeTitle) ? (isRoot ? sheetTitle || "" : "") : nodeTitle,
    };
    try {
      const notesElement = getItemByName(nodeElements, "notes");
      if (notesElement) {
        newNode.data.note =
          notesElement.elements[0].elements[0].elements[0].text;
      }
    } catch (error) {
      console.error(error);
    }
    try {
      if (
        node.attributes?.["xlink:href"] &&
        /^https?:\/\//.test(node.attributes["xlink:href"])
      ) {
        newNode.data.hyperlink = node.attributes["xlink:href"];
      }
    } catch (error) {
      console.error(error);
    }
    try {
      const labelsElement = getItemByName(nodeElements, "labels");
      if (labelsElement) {
        newNode.data.tag = labelsElement.elements.map((item: AnyRecord) => {
          return item.elements[0].text;
        });
      }
    } catch (error) {
      console.error(error);
    }
    handleOldNodeImageFromXmind(node, newNode, waitLoadImageList, files);
    const childrenItem = getItemByName(nodeElements, "children");
    const selfSummary: any[] = [];
    const childrenSummary: any[] = [];
    try {
      if (newNode._summary) {
        selfSummary.push(newNode._summary);
      }
      const summariesItem = getItemByName(nodeElements, "summaries");
      if (
        summariesItem &&
        Array.isArray(summariesItem.elements) &&
        summariesItem.elements.length > 0
      ) {
        summariesItem.elements.forEach((item: AnyRecord) => {
          addSummaryData(
            selfSummary,
            childrenSummary,
            () => {
              return getSafeSummaryText2(
                childrenItem,
                item.attributes["topic-id"],
              );
            },
            item.attributes.range,
          );
        });
      }
    } catch (error) {
      console.error(error);
    }
    newNode.data.generalization = selfSummary;
    newNode.children = [];
    if (childrenItem?.elements && childrenItem.elements.length > 0) {
      const children = getOldTopicChildren(childrenItem);
      const appendChild = (item: AnyRecord, index: number) => {
        const newChild: AnyRecord = {};
        newNode.children.push(newChild);
        if (childrenSummary[index]) {
          newChild._summary = childrenSummary[index];
        }
        walk(item, newChild);
      };
      (children || []).forEach(appendChild);
    }
  };
  walk(root, newTree, true);
  await Promise.all(waitLoadImageList);
  return newTree;
};

// 直接转换为最新版本的xmind文件 2023.09.11172
const transformToXmind = async (
  data: AnyRecord,
  name: string,
): Promise<Blob> => {
  const id = `simpleMindMap_${Date.now()}`;
  const imageList: AnyRecord[] = [];
  const newTree: AnyRecord = {};
  const waitLoadImageList: Promise<any>[] = [];
  const walk = async (
    node: AnyRecord,
    newNode: AnyRecord,
    isRoot?: boolean,
  ) => {
    const newData: AnyRecord = {
      id: node.data.uid,
      structureClass: "org.xmind.ui.logic.right",
      title: getTextFromHtml(node.data.text),
      children: {
        attached: [] as AnyRecord[],
      },
    };
    if (node.data.note !== undefined) {
      newData.notes = {
        realHTML: {
          content: node.data.note,
        },
        plain: {
          content: node.data.note,
        },
      };
    }
    if (node.data.hyperlink !== undefined) {
      newData.href = node.data.hyperlink;
    }
    if (node.data.tag !== undefined) {
      newData.labels = (node.data.tag || []).map((item: any) => {
        return typeof item === "object" && item !== null ? item.text : item;
      });
    }
    handleNodeImageToXmind(node, newNode, waitLoadImageList, imageList);
    // 暂时不考虑样式
    if (isRoot) {
      newData.class = "topic";
      newNode.id = id;
      newNode.class = "sheet";
      newNode.title = name;
      newNode.extensions = [];
      newNode.topicPositioning = "fixed";
      newNode.topicOverlapping = "overlap";
      newNode.coreVersion = "2.100.0";
      newNode.rootTopic = newData;
    } else {
      Object.keys(newData).forEach((key) => {
        newNode[key] = newData[key];
      });
    }
    const { summary, summaries } = parseNodeGeneralizationToXmind(node);
    if (isRoot) {
      if (summaries.length > 0) {
        newNode.rootTopic.children.summary = summary;
        newNode.rootTopic.summaries = summaries;
      }
    } else {
      if (summaries.length > 0) {
        newNode.children.summary = summary;
        newNode.summaries = summaries;
      }
    }
    if (node.children && node.children.length > 0) {
      node.children.forEach((child: AnyRecord) => {
        const newChild: AnyRecord = {};
        walk(child, newChild);
        newData.children.attached.push(newChild);
      });
    }
  };
  walk(data, newTree, true);
  await Promise.all(waitLoadImageList);
  const contentData = [newTree];
  const zip = new JSZip();
  zip.file("content.json", JSON.stringify(contentData));
  zip.file(
    "metadata.json",
    `{"modifier":"","dataStructureVersion":"2","creator":{"name":"mind-map"},"layoutEngineVersion":"3","activeSheetId":"${id}"}`,
  );
  zip.file("content.xml", getXmindContentXmlData());
  const manifestData = {
    "file-entries": {
      "content.json": {},
      "metadata.json": {},
      "Thumbnails/thumbnail.png": {},
    },
  } as AnyRecord;
  if (imageList.length > 0) {
    imageList.forEach((item: AnyRecord) => {
      manifestData["file-entries"][`resources/${item.name}`] = {};
      const img = zip.folder("resources") as any;
      img.file(item.name, item.data, { base64: true });
    });
  }
  zip.file("manifest.json", JSON.stringify(manifestData));
  const zipData = await zip.generateAsync({ type: "blob" });
  return zipData;
};

export default {
  parseXmindFile,
  transformXmind,
  transformOldXmind,
  transformToXmind,
};
