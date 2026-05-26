import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bold,
  Braces,
  CheckSquare,
  ChevronsLeft,
  Code,
  Copy,
  Download,
  Edit,
  Expand,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Fullscreen,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Heading,
  Image,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Maximize2,
  Menu,
  MessageSquare,
  Minus,
  Minimize2,
  MousePointer2,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  PanelLeft,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  RotateCw,
  Scan,
  Search,
  Send,
  Square,
  Strikethrough,
  Table,
  Text,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import type React from "react";

export const IconAbbreviation1 = Text;
export const IconAddDocLine = FilePlus;
export const IconAddFolderLine = Folder;
export const IconAddLeft = MoveLeft;
export const IconAddRight = MoveRight;
export const IconBlod1 = Bold;
export const IconBottomAlignment1 = MoveDown;
export const IconChecklist1 = CheckSquare;
export const IconCodeBrackets1 = Braces;
export const IconCopy = Copy;
export const IconDelete = Trash2;
export const IconDown = ArrowDown;
export const IconDownload = Download;
export const IconDragDotVertical = PanelLeft;
export const IconEdit = Edit;
export const IconExpand = Maximize2;
export const IconExpand1 = Expand;
export const IconFileDoc = FileText;
export const IconFolderCloseFill = Folder;
export const IconFolderOpenFill = FolderOpen;
export const IconFullscreen = Fullscreen;
export const IconFullscreenExit = MinimizeIcon;
export const IconH11 = Heading1;
export const IconH21 = Heading2;
export const IconH31 = Heading3;
export const IconH41 = Heading4;
export const IconH51 = Heading5;
export const IconH61 = Heading6;
export const IconHn1 = Heading;
export const IconHorizontalAlignment1 = AlignCenter;
export const IconImage1 = Image;
export const IconIndentLeft1 = IndentDecrease;
export const IconIndentRight1 = IndentIncrease;
export const IconInderline1 = Underline;
export const IconInlineCode1 = Code;
export const IconItalic1 = Italic;
export const IconLeft = ArrowLeft;
export const IconLeftAlignment1 = AlignLeft;
export const IconLink1 = Link;
export const IconMenu = Menu;
export const IconMessage = MessageSquare;
export const IconMinus = Minus;
export const IconOrderedList1 = ListOrdered;
export const IconPlus = Plus;
export const IconQuoted1 = Quote;
export const IconRecordStop = Square;
export const IconRedo1 = Redo2;
export const IconRefresh = RefreshCw;
export const IconRevise1 = MousePointer2;
export const IconRight = ArrowRight;
export const IconRightAlignment1 = AlignRight;
export const IconScan = Scan;
export const IconSearch = Search;
export const IconSend = Send;
export const IconShrink = MinimizeIcon;
export const IconStrikethrough1 = Strikethrough;
export const IconSync = RotateCw;
export const IconTable1 = Table;
export const IconText1 = Text;
export const IconText2 = Text;
export const IconToLeft = ChevronsLeft;
export const IconTopAlignment1 = MoveUp;
export const IconUndo1 = Undo2;
export const IconUnorderedList1 = List;
export const IconVerticalAlignment1 = AlignCenter;

function MinimizeIcon(props: React.ComponentProps<typeof Minimize2>) {
  return <Minimize2 {...props} />;
}
