import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SimpleMarkdown, MarkdownContent } from "@/components/SimpleMarkdown";

describe("SimpleMarkdown", () => {
  it("returns null for empty string", () => {
    const { container } = render(<SimpleMarkdown text="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders plain text as a span", () => {
    render(<SimpleMarkdown text="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders bold text with <strong>", () => {
    render(<SimpleMarkdown text="This is **bold** text" />);
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
  });

  it("renders inline code with <code>", () => {
    render(<SimpleMarkdown text="Run `npm install` first" />);
    const code = screen.getByText("npm install");
    expect(code.tagName).toBe("CODE");
  });

  it("renders links with correct href", () => {
    render(<SimpleMarkdown text="See [the docs](https://example.com) for more" />);
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders mixed inline formatting", () => {
    render(<SimpleMarkdown text="**Bold** and `code` and [link](https://x.com)" />);
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute("href", "https://x.com");
  });
});

describe("MarkdownContent", () => {
  it("returns null for empty string", () => {
    const { container } = render(<MarkdownContent text="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a plain paragraph", () => {
    render(<MarkdownContent text="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders bullet list items", () => {
    render(<MarkdownContent text={"- item one\n- item two\n- item three"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByText("item one")).toBeInTheDocument();
    expect(screen.getByText("item three")).toBeInTheDocument();
  });

  it("renders multiple paragraphs separated by blank lines", () => {
    render(<MarkdownContent text={"First paragraph\n\nSecond paragraph"} />);
    expect(screen.getByText("First paragraph")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph")).toBeInTheDocument();
  });

  it("applies optional className", () => {
    const { container } = render(
      <MarkdownContent text="Hello" className="custom-class" />
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });
});
