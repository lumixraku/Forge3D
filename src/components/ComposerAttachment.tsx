import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

// An attachment chip inside the composer: thumbnail, name, and a hover preview.
export default function ComposerAttachment({ node }: NodeViewProps) {
  const isImage = String(node.attrs.type || '').startsWith('image/')
  const preview = isImage && node.attrs.preview
  return (
    <NodeViewWrapper as="span" contentEditable={false} className="forge3d-composer-attachment forge:group forge:relative forge:mx-[3px] forge:inline-flex forge:h-[25px] forge:min-w-0 forge:max-w-[min(120px,100%)] forge:select-none forge:items-center forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input-hover forge:py-0 forge:pl-[3px] forge:pr-2 forge:align-middle forge:leading-none forge:text-text-primary forge:[&.ProseMirror-selectednode]:border-acid forge:[&.ProseMirror-selectednode]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--acid)_20%,transparent)]">
      {preview
        ? <img className="forge:mr-[5px] forge:grid forge:size-[19px] forge:place-items-center forge:rounded-[5px] forge:bg-bg-active forge:object-cover forge:text-[11px]" src={node.attrs.preview} alt="" />
        : <span className="forge:mr-[5px] forge:grid forge:size-[19px] forge:place-items-center forge:rounded-[5px] forge:bg-bg-active forge:text-[11px]" aria-hidden="true">📎</span>}
      <span className="forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap">{node.attrs.name}</span>
      {preview ? (
        <span className="forge3d-composer-attachment-preview forge:absolute forge:bottom-[calc(100%+10px)] forge:left-1/2 forge:z-30 forge:block forge:w-[220px] forge:origin-bottom forge:-translate-x-1/2 forge:translate-y-[5px] forge:scale-[.98] forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-panel forge:opacity-0 forge:shadow-[0_12px_28px_color-mix(in_srgb,#000_24%,transparent)] forge:transition-[opacity,transform] forge:duration-120 forge:pointer-events-none forge:group-hover:translate-y-0 forge:group-hover:scale-100 forge:group-hover:opacity-100 forge:group-focus-within:translate-y-0 forge:group-focus-within:scale-100 forge:group-focus-within:opacity-100" role="tooltip">
          <img className="forge:block forge:h-[180px] forge:w-full forge:rounded-[9px] forge:bg-bg-primary forge:object-cover" src={node.attrs.preview} alt={`Preview of ${node.attrs.name}`} />
        </span>
      ) : null}
    </NodeViewWrapper>
  )
}
