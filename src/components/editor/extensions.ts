import { convertFileSrc } from "@tauri-apps/api/core";
import type { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Mathematics } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import "katex/dist/katex.min.css";
import { Markdown } from "@tiptap/markdown";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockWithCopy } from "./CodeBlock";
import { WikiLink } from "./wikiLink";
import { textColorExtensions } from "./textColors";

function isRemoteSource(src: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(src);
}

/**
 * Delete the whole table on Backspace/Delete when it has no content anywhere
 * and the cursor sits at the start of the (empty) cell it's in. Tiptap's
 * table extension has no built-in "dissolve when empty" behavior like other
 * nodes get, so an empty table otherwise just sits there no matter how many
 * times Backspace is pressed.
 */
function deleteIfEmptyTable(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parentOffset !== 0) return false;

  let tableDepth: number | null = null;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth === null) return false;

  const tableNode = $from.node(tableDepth);
  if (tableNode.textContent.length > 0) return false;

  return editor.commands.deleteTable();
}

const EmptyTableDeletable = Table.extend({
  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteIfEmptyTable(this.editor),
      Delete: () => deleteIfEmptyTable(this.editor),
    };
  },
});

/**
 * Image node that keeps a vault-relative path (".xuro/assets/…") in the
 * markdown while rendering through Tauri's asset protocol.
 */
const VaultImage = (vaultRoot: string) =>
  Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        vaultSrc: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-vault-src"),
          renderHTML: (attributes) =>
            attributes.vaultSrc
              ? { "data-vault-src": attributes.vaultSrc }
              : {},
        },
      };
    },

    renderHTML({ HTMLAttributes }) {
      const vaultSrc = HTMLAttributes.vaultSrc ?? HTMLAttributes.src;
      const src =
        vaultRoot && vaultSrc && !isRemoteSource(vaultSrc)
          ? convertFileSrc(`${vaultRoot.replace(/\/$/, "")}/${vaultSrc}`)
          : HTMLAttributes.src;
      return ["img", { ...HTMLAttributes, src, "data-vault-src": vaultSrc }];
    },

    renderMarkdown: (node) => {
      const src = node.attrs?.vaultSrc ?? node.attrs?.src ?? "";
      const alt = node.attrs?.alt ?? "";
      return `![${alt}](${src})`;
    },
  });

export function createExtensions(
  vaultRoot: string,
  getEditor: () => Editor | null,
) {
  return [
    Markdown.configure({
      markedOptions: { breaks: true, gfm: true },
    }),
    StarterKit.configure({ link: false, codeBlock: false }),
    ...textColorExtensions,
    CodeBlockWithCopy,
    Underline,
    Typography,
    Link.configure({
      autolink: true,
      defaultProtocol: "https",
      openOnClick: false,
      protocols: ["http", "https", "mailto"],
      // Keep relative hrefs (our internal page links, e.g. "projects/app.md").
      // Without this the default sanitizer resolves them against the app's
      // tauri:// origin and strips them. External URLs still get validated.
      isAllowedUri: (uri, ctx) => {
        if (!/^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith("//")) {
          return true;
        }
        return ctx.defaultValidate(uri);
      },
    }),
    VaultImage(vaultRoot).configure({ allowBase64: true, inline: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    EmptyTableDeletable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder: "Write, or press / for blocks…" }),
    WikiLink,
    Mathematics.configure({
      inlineOptions: {
        onClick: (node, pos) => {
          const latex = window.prompt("Edit LaTeX", node.attrs.latex as string);
          if (latex === null) return;
          getEditor()?.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run();
        },
      },
      blockOptions: {
        onClick: (node, pos) => {
          const latex = window.prompt("Edit LaTeX", node.attrs.latex as string);
          if (latex === null) return;
          getEditor()?.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run();
        },
      },
    }),
  ];
}
