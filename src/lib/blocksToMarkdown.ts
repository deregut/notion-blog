import type { Block, RichText } from "./notion";
import { getRichText, getCaption, getMediaUrl } from "@/components/blocks/helpers";

// ---------------------------------------------------------------------------
// RichText → Markdown inline
// ---------------------------------------------------------------------------

export function richTextToMarkdown(texts: RichText[]): string {
  return texts
    .map((t) => {
      const plain = t.plain_text;
      if (!plain) return "";

      if (t.type === "equation") return `\`${plain}\``;
      if (t.type === "mention") return plain;

      const a = t.annotations;

      if (a.code) {
        return t.href ? `[\`${plain}\`](${t.href})` : `\`${plain}\``;
      }

      let s = plain;
      if (a.strikethrough) s = `~~${s}~~`;
      if (a.bold && a.italic) s = `***${s}***`;
      else if (a.bold) s = `**${s}**`;
      else if (a.italic) s = `*${s}*`;

      if (t.href) s = `[${s}](${t.href})`;

      return s;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Block grouping (ported from NotionRenderer.vue)
// ---------------------------------------------------------------------------

interface BlockGroup {
  type: string;
  items: Block[];
}

function groupBlocks(blocks: Block[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const block of blocks) {
    const t = block.type;
    if (t === "bulleted_list_item" || t === "numbered_list_item") {
      const last = groups[groups.length - 1];
      if (last && last.type === t) {
        last.items.push(block);
      } else {
        groups.push({ type: t, items: [block] });
      }
    } else {
      groups.push({ type: t, items: [block] });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Single block → Markdown
// ---------------------------------------------------------------------------

function blockToMarkdown(block: Block, indent: string): string {
  const data = (block as any)[block.type];

  switch (block.type) {
    case "paragraph": {
      const text = richTextToMarkdown(getRichText(block));
      return `${indent}${text}\n`;
    }

    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = block.type === "heading_1" ? 1 : block.type === "heading_2" ? 2 : 3;
      const prefix = "#".repeat(level);
      const text = richTextToMarkdown(getRichText(block));
      const isToggleable = data?.is_toggleable ?? false;

      if (isToggleable && block.children?.length) {
        const children = blocksToLines(block.children, indent);
        return `<details>\n<summary>${prefix} ${text}</summary>\n\n${children}\n</details>\n`;
      }
      return `${prefix} ${text}\n`;
    }

    case "bulleted_list_item": {
      const text = richTextToMarkdown(getRichText(block));
      const childIndent = indent + "  ";
      let result = `${indent}- ${text}\n`;
      if (block.children?.length) {
        result += blocksToLines(block.children, childIndent);
      }
      return result;
    }

    case "numbered_list_item": {
      const text = richTextToMarkdown(getRichText(block));
      const childIndent = indent + "   ";
      let result = `${indent}1. ${text}\n`;
      if (block.children?.length) {
        result += blocksToLines(block.children, childIndent);
      }
      return result;
    }

    case "to_do": {
      const checked = data?.checked ?? false;
      const text = richTextToMarkdown(getRichText(block));
      return `${indent}- [${checked ? "x" : " "}] ${text}\n`;
    }

    case "toggle": {
      const text = richTextToMarkdown(getRichText(block));
      const children = block.children?.length
        ? blocksToLines(block.children, indent)
        : "";
      return `<details>\n<summary>${text}</summary>\n\n${children}\n</details>\n`;
    }

    case "code": {
      const lang: string = data?.language ?? "";
      const code = (data?.rich_text ?? [])
        .map((t: RichText) => t.plain_text)
        .join("");
      const caption = getCaption(block);
      let result = `${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\`\n`;
      if (caption.length) {
        result += `${indent}*${richTextToMarkdown(caption)}*\n`;
      }
      return result;
    }

    case "quote": {
      const text = richTextToMarkdown(getRichText(block));
      const lines = text.split("\n").map((l) => `${indent}> ${l}`);
      let result = lines.join("\n") + "\n";
      if (block.children?.length) {
        const childLines = blocksToLines(block.children, "").trimEnd().split("\n");
        result += childLines.map((l) => `${indent}> ${l}`).join("\n") + "\n";
      }
      return result;
    }

    case "callout": {
      const icon =
        data?.icon?.type === "emoji" ? data.icon.emoji : "\u{1F4A1}";
      const text = richTextToMarkdown(getRichText(block));
      const firstLine = `${indent}> ${icon} ${text}`;
      let result = firstLine + "\n";
      if (block.children?.length) {
        const childLines = blocksToLines(block.children, "").trimEnd().split("\n");
        result += childLines.map((l) => `${indent}> ${l}`).join("\n") + "\n";
      }
      return result;
    }

    case "divider":
      return `${indent}---\n`;

    case "image": {
      const url = block.localImageUrl ?? getMediaUrl(block);
      const caption = getCaption(block);
      const alt = caption.map((t) => t.plain_text).join("") || "image";
      let result = `${indent}![${alt}](${url})\n`;
      if (caption.length) {
        result += `${indent}*${richTextToMarkdown(caption)}*\n`;
      }
      return result;
    }

    case "video": {
      const url = getMediaUrl(block);
      const caption = getCaption(block);
      const label = caption.length
        ? richTextToMarkdown(caption)
        : "Video";
      return `${indent}[${label}](${url})\n`;
    }

    case "bookmark":
    case "link_preview": {
      const url = data?.url ?? "";
      const title = block.ogp?.title ?? url;
      return `${indent}[${title}](${url})\n`;
    }

    case "embed": {
      const url = data?.url ?? "";
      const caption = getCaption(block);
      const label = caption.length
        ? richTextToMarkdown(caption)
        : url;
      return `${indent}[${label}](${url})\n`;
    }

    case "table": {
      const hasHeader = data?.has_column_header ?? false;
      const rows = block.children ?? [];
      if (rows.length === 0) return "";

      const tableRows = rows.map((row) => {
        const cells: RichText[][] = (row as any).table_row?.cells ?? [];
        return cells.map((cell) =>
          richTextToMarkdown(cell).replace(/\|/g, "\\|")
        );
      });

      const colCount = Math.max(...tableRows.map((r) => r.length), 1);
      const normalize = (row: string[]) => {
        while (row.length < colCount) row.push("");
        return row;
      };

      const lines: string[] = [];
      const headerRow = hasHeader ? tableRows[0] : undefined;
      const dataStart = hasHeader ? 1 : 0;

      if (headerRow) {
        lines.push(`| ${normalize(headerRow).join(" | ")} |`);
      } else {
        lines.push(`| ${Array(colCount).fill("").join(" | ")} |`);
      }
      lines.push(`| ${Array(colCount).fill("---").join(" | ")} |`);

      for (let i = dataStart; i < tableRows.length; i++) {
        lines.push(`| ${normalize(tableRows[i]).join(" | ")} |`);
      }

      return indent + lines.join("\n" + indent) + "\n";
    }

    case "column_list": {
      const columns = block.children ?? [];
      return columns
        .map((col) =>
          col.children?.length ? blocksToLines(col.children, indent) : ""
        )
        .join("\n");
    }

    case "file":
    case "pdf":
    case "audio": {
      const url = getMediaUrl(block);
      const caption = getCaption(block);
      const label = caption.length
        ? caption.map((t) => t.plain_text).join("")
        : url;
      return `${indent}[${label}](${url})\n`;
    }

    case "synced_block": {
      if (block.children?.length) {
        return blocksToLines(block.children, indent);
      }
      return "";
    }

    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Block[] → Markdown lines (internal helper)
// ---------------------------------------------------------------------------

function blocksToLines(blocks: Block[], indent: string): string {
  const groups = groupBlocks(blocks);
  const parts: string[] = [];

  for (const group of groups) {
    if (
      group.type === "bulleted_list_item" ||
      group.type === "numbered_list_item"
    ) {
      for (const item of group.items) {
        parts.push(blockToMarkdown(item, indent));
      }
      parts.push("");
    } else {
      for (const item of group.items) {
        parts.push(blockToMarkdown(item, indent));
      }
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function blocksToMarkdown(blocks: Block[]): string {
  return blocksToLines(blocks, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
