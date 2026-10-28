import { Fragment } from 'react'
import { nextTick, onBeforeUnmount, onMounted, state, watch, useSetup, cx } from '../store'
import { bizClass } from '../class-prefix';
import { EditorContent } from '@tiptap/react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { canContinueSelection, selectedOptionIds } from '../chat-selection';

const SPEC = { props: ["messages","editor","busy","error","composerHasContent","continuingTurnId","selectedOptions"], emits: ["send","attach-files","toggle-option","continue-turn","retry","engaged"] }

export default function ChatPanel(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    const fileInput = state<HTMLInputElement | null>(null);
    const messageList = state<HTMLElement | null>(null);
    const messageBody = state<HTMLElement | null>(null);
    // A reply is one message that grows after it is inserted, so watching the
    // message count leaves the new text below the composer. Stay pinned to the
    // bottom until the reader scrolls up to look at older messages.
    let stickToBottom = true;
    let pinning = false;
    let bodyObserver: ResizeObserver | null = null;
    function distanceFromBottom(list: HTMLElement) {
      return list.scrollHeight - list.scrollTop - list.clientHeight;
    }
    function pinToBottom() {
      const list = messageList.value;
      if (!list || !stickToBottom) return;
      if (distanceFromBottom(list) < 2) return;
      pinning = true;
      list.scrollTop = list.scrollHeight;
    }
    function onListScroll() {
      const list = messageList.value;
      if (!list) return;
      if (pinning) {
        pinning = false;
        return;
      }
      stickToBottom = distanceFromBottom(list) < 48;
    }
    watch(() => props.messages.map(message => message.id).join('|'), async () => {
      stickToBottom = true;
      await nextTick();
      pinToBottom();
    }, {
      immediate: true
    });
    onMounted(() => {
      if (messageBody.value) {
        bodyObserver = new ResizeObserver(() => pinToBottom());
        bodyObserver.observe(messageBody.value);
      }
      pinToBottom();
    });
    onBeforeUnmount(() => bodyObserver?.disconnect());
    function renderAssistantMarkdown(content: string) {
      return DOMPurify.sanitize(marked.parse(content || '', {
        async: false,
        breaks: true,
        gfm: true,
        html: false
      }));
    }
    function optionIds(message) {
      return selectedOptionIds(message, props.selectedOptions);
    }
    function canContinue(message) {
      return canContinueSelection(message, props.selectedOptions);
    }
    function addFiles(event) {
      const files = [...(event.target.files || [])];
      event.target.value = '';
      emit('attach-files', files);
    }
    function isImage(attachment) {
      return attachment?.type?.startsWith('image/') && attachment.preview;
    }
    function userContent(message) {
      return (message.content || '').replace(/\[Attachment: [^\]]+\]\s*/g, '').trim();
    }
    return {
      bizClass,
      marked,
      canContinueSelection,
      selectedOptionIds,
      fileInput,
      messageList,
      messageBody,
      get stickToBottom() { return stickToBottom }, set stickToBottom(v) { stickToBottom = v },
      get pinning() { return pinning }, set pinning(v) { pinning = v },
      get bodyObserver() { return bodyObserver }, set bodyObserver(v) { bodyObserver = v },
      distanceFromBottom,
      pinToBottom,
      onListScroll,
      renderAssistantMarkdown,
      optionIds,
      canContinue,
      addFiles,
      isImage,
      userContent
    }
  })
  return (
    <section {...vm.$attrs} onFocus={($event: any) => { vm.emit('engaged'); }} className={cx("forge:grid forge:min-h-0 forge:min-w-0 forge:grid-cols-[minmax(0,1fr)] forge:grid-rows-[62px_minmax(0,1fr)_auto_auto] forge:overflow-hidden forge:border-r forge:border-line forge:bg-bg-panel forge:transition-colors forge:duration-200", vm.$attrs.className)} style={vm.$attrs.style}><header className={"forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:px-[17px]"}><div ><span className={"forge:text-[12px] forge:font-semibold forge:text-text-muted"}>{"Canvas copilot"}</span>
<b className={"forge:mt-1 forge:block forge:text-[11px]"}>{"DeepSeek tool-calling agent"}</b></div>
<i className={"forge:size-[7px] forge:rounded-full forge:bg-acid forge:shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_60%,transparent)]"} /></header>
<div ref={vm.$ref("messageList")} onScroll={($event: any) => { vm.onListScroll($event) }} className={"forge:min-w-0 forge:overflow-y-auto forge:px-[17px] forge:pb-7 forge:pt-[22px]"}><div ref={vm.$ref("messageBody")}>{(vm.messages).map((message) => (<article key={message.id} className={cx("forge:mb-6 forge:min-w-0 forge:[&>span]:mb-[7px] forge:[&>span]:block forge:[&>span]:text-[12px] forge:[&>span]:font-semibold forge:[&>span]:text-text-muted forge:[&.forge3d-assistant>span]:text-acid forge:[&.forge3d-pending_p]:text-text-muted forge:[&.forge3d-user]:ml-auto forge:[&.forge3d-user]:w-[min(100%,360px)] forge:[&.forge3d-user]:rounded-[14px_14px_3px_14px] forge:[&.forge3d-user]:border forge:[&.forge3d-user]:border-line-strong forge:[&.forge3d-user]:bg-bg-input forge:[&.forge3d-user]:p-[13px] forge:[&.forge3d-user]:shadow-sm forge:[&.forge3d-user>span]:mb-[9px] forge:[&.forge3d-user>span]:text-right forge:[&.forge3d-user>span]:text-acid forge:[&.forge3d-user_p]:text-text-primary", [vm.bizClass(message.role), {
  'forge3d-pending': message.pending
}])}><span >{message.role === 'assistant' ? '3D workflow' : 'You'}</span>
{(message.role === 'assistant') ? (<>{(message.pending) ? (<div className={"forge:grid forge:gap-[5px] forge:text-[13px] forge:text-text-secondary"}><b className={"forge:text-[13px] forge:text-text-primary"}>{"Thinking"}</b>
<span className={"forge:after:content-['...'] forge:after:animate-[thinking-ellipsis_1.1s_steps(4,end)_infinite]"}>{message.progress.at(-1)?.label || 'Preparing canvas agent'}</span></div>) : ((message.progress?.length) ? (<details className={"forge3d-thought-process forge:mb-[10px] forge:border-l-2 forge:border-line-strong forge:text-[11px] forge:text-text-muted forge:[&>span]:ml-[17px] forge:[&>span]:mt-[7px] forge:[&>span]:block forge:[&_summary]:cursor-pointer forge:[&_summary]:list-none forge:[&_summary]:pl-[9px] forge:[&_summary]:transition-colors forge:[&_summary]:hover:text-acid forge:[&_summary_small]:ml-[5px] forge:[&_summary_small]:font-mono forge:[&_summary_small]:text-[11px] forge:[&_summary_small]:text-text-muted"}><summary >{"Thought process "}
<small >{"Tool activity"}</small></summary>
{(message.progress).map((event, index) => (<span key={`${event.label}-${index}`}>{event.label}</span>))}</details>) : (null))}
{(message.content) ? (<div className={"forge3d-message-content forge:text-[13px] forge:leading-[1.55] forge:text-text-secondary forge:[overflow-wrap:anywhere]"} dangerouslySetInnerHTML={{ __html: vm.renderAssistantMarkdown(message.content) }} />) : (null)}
{(message.failed) ? (<button type={"button"} title={"重试"} aria-label={"重试"} disabled={vm.busy} onClick={($event: any) => { vm.emit('retry', message); }} className={"forge:mt-[9px] forge:grid forge:size-7 forge:place-items-center forge:rounded-md forge:border-0 forge:bg-transparent forge:p-0 forge:text-text-muted forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid forge:focus-visible:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:focus-visible:text-acid forge:focus-visible:outline-0 forge:[&_svg]:size-[15px] forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.8]"}><svg viewBox={"0 0 24 24"} aria-hidden={"true"}><path d={"M20 7v5h-5"} />
<path d={"M19 12a7 7 0 1 0-2.05 4.95"} /></svg></button>) : (null)}
{(message.request) ? (<section className={"forge:mt-[10px] forge:grid forge:gap-[9px] forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-3"}><p className={"forge:m-0 forge:font-semibold forge:text-text-primary"}>{message.request.prompt}</p>
<small className={"forge:font-mono forge:text-[11px] forge:font-medium forge:text-text-muted"}>{"Select "}
{message.request.min === message.request.max ? message.request.min : `${message.request.min}–${message.request.max}`}
{" option"}
{message.request.max === 1 ? '' : 's'}
{"."}</small>
<div className={"forge:grid forge:gap-1.5"}>{(message.request.options).map((option) => (<button key={option.id} type={"button"} disabled={Boolean(message.selection) || message.pending || vm.continuingTurnId === message.turnId} onClick={($event: any) => { vm.emit('toggle-option', {
  message: message,
  optionId: option.id
}); }} className={cx("forge:[--btn-shadow:var(--acid-shadow)] forge:rounded-md forge:border forge:border-acid-line forge:bg-[color-mix(in_srgb,var(--acid)_6%,var(--bg-input))] forge:px-[10px] forge:py-2 forge:text-left forge:text-xs forge:text-acid-dim forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid forge:[&.forge3d-selected]:border-acid forge:[&.forge3d-selected]:bg-[color-mix(in_srgb,var(--acid)_16%,var(--bg-input))] forge:[&.forge3d-selected]:text-acid-dim", {
  'forge3d-selected': vm.optionIds(message).includes(option.id)
})}>{option.label}</button>))}</div>
{(message.selection) ? (<span className={"forge:justify-self-start forge:font-mono forge:text-[11px] forge:font-semibold forge:text-acid"}>{"Answered"}</span>) : (<button type={"button"} disabled={!vm.canContinue(message) || message.pending || vm.continuingTurnId === message.turnId} onClick={($event: any) => { vm.emit('continue-turn', message); }} className={"forge:justify-self-start forge:rounded-md forge:border-0 forge:bg-acid forge:px-[11px] forge:py-[7px] forge:font-mono forge:text-[11px] forge:font-semibold forge:text-text-inverse"}>{vm.continuingTurnId === message.turnId ? 'Continuing…' : 'Continue'}</button>)}</section>) : (null)}</>) : (<div className={"forge:min-w-0"}>{(message.attachments?.length) ? (<span className={"forge:inline"}>{(message.attachments).map((attachment) => (<a key={attachment.id || attachment.name} href={vm.isImage(attachment) ? attachment.preview : undefined} target={vm.isImage(attachment) ? '_blank' : undefined} rel={"noreferrer"} className={"forge:group forge:relative forge:mr-[3px] forge:mb-[5px] forge:inline-flex forge:h-[25px] forge:min-w-0 forge:max-w-[min(120px,100%)] forge:items-center forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input-hover forge:py-0 forge:pl-[3px] forge:pr-2 forge:align-middle forge:leading-none forge:text-text-primary forge:no-underline forge:hover:border-[color-mix(in_srgb,var(--acid)_55%,var(--line-strong))]"}>{(vm.isImage(attachment)) ? (<img src={attachment.preview} alt={attachment.name} className={"forge:mr-[5px] forge:size-[19px] forge:flex-none forge:rounded-[5px] forge:bg-bg-active forge:object-cover"} />) : (<span aria-hidden={"true"} className={"forge:mr-[5px] forge:grid forge:size-[19px] forge:flex-none forge:place-items-center forge:rounded-[5px] forge:bg-bg-active forge:text-acid forge:[&_svg]:size-3 forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.6]"}><svg viewBox={"0 0 24 24"}><path d={"M6.5 3.5h7l4 4v13h-11zM13.5 3.5v4h4M9 12h6M9 16h6"} /></svg></span>)}
<span className={"forge:min-w-0 forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:text-[11px] forge:font-semibold"}>{attachment.name}</span>
{(vm.isImage(attachment)) ? (<img src={attachment.preview} alt={attachment.name} className={"forge:absolute forge:bottom-[calc(100%+10px)] forge:left-0 forge:z-[5] forge:block forge:max-h-[220px] forge:w-[min(260px,60vw)] forge:translate-y-1 forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-panel forge:object-contain forge:opacity-0 forge:shadow-[0_10px_22px_color-mix(in_srgb,#000_25%,transparent)] forge:transition-[opacity,transform] forge:duration-120 forge:pointer-events-none forge:group-hover:translate-y-0 forge:group-hover:opacity-100 forge:group-focus-visible:translate-y-0 forge:group-focus-visible:opacity-100"} />) : (null)}</a>))}</span>) : (null)}
{(vm.userContent(message)) ? (<p className={"forge:m-0 forge:min-w-0 forge:text-[13px] forge:leading-[1.55] forge:text-text-secondary forge:[overflow-wrap:anywhere]"}>{vm.userContent(message)}</p>) : (null)}</div>)}</article>))}</div></div>
{(vm.error) ? (<p className={"forge:mx-[17px] forge:mb-2 forge:mt-0 forge:text-[11px] forge:text-status-failed"}>{vm.error}</p>) : (null)}
<form onSubmit={($event: any) => { $event.preventDefault(); vm.emit('send'); }} className={"forge:mx-3 forge:mb-3 forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-[10px] forge:transition-[border-color,box-shadow] forge:focus-within:border-[color-mix(in_srgb,var(--acid)_45%,var(--line-strong))] forge:focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--acid)_10%,transparent)]"}><EditorContent editor={vm.editor} />
<input ref={vm.$ref("fileInput")} type={"file"} multiple onChange={($event: any) => { vm.addFiles($event) }} className={"forge:hidden"} />
<div className={"forge:mt-[5px] forge:flex forge:items-center forge:justify-end forge:gap-[7px] forge:[&_button]:grid forge:[&_button]:size-[30px] forge:[&_button]:place-items-center forge:[&_button]:rounded-full forge:[&_button]:border-0 forge:[&_button]:bg-acid forge:[&_button]:p-0 forge:[&_button]:text-text-inverse forge:[&_button]:transition-[transform,filter,box-shadow] forge:[&_button]:hover:-translate-y-px forge:[&_button]:hover:brightness-108 forge:[&_button]:focus-visible:outline-none forge:[&_button]:focus-visible:shadow-[0_0_0_2px_var(--bg-primary),0_0_0_4px_color-mix(in_srgb,var(--acid)_50%,transparent)] forge:[&_svg]:size-[15px] forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.8]"}><button type={"button"} title={"Attach files"} aria-label={"Attach files"} onClick={($event: any) => { vm.fileInput.click(); }} className={"forge:!border forge:[--btn-shadow:var(--acid-shadow)] forge:!border-acid-line forge:!bg-bg-input-hover forge:!text-acid-dim forge:hover:!border-acid forge:hover:!text-acid"}><svg viewBox={"0 0 24 24"} aria-hidden={"true"}><path d={"m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.6 9.5a2 2 0 0 1-2.8-2.8l8.8-8.8"} /></svg></button>
<div className={"forge:flex forge:items-center forge:gap-1.5"}><button type={"submit"} title={"Send"} aria-label={"Send"} disabled={vm.busy || !vm.composerHasContent}><svg viewBox={"0 0 24 24"} aria-hidden={"true"}><path d={"m5 12 14-7-4 14-3-6-7-1Z"} />
<path d={"m12 13 7-8"} /></svg></button></div></div></form></section>
  )
}
