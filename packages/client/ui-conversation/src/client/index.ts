/** Browser Conversation assemble core, React adapter, shell, and input plugin. */
export { apply, inject } from './apply.ts'
export { UiConversation } from './conversation/assembly.ts'
export type { ConversationBinding } from './conversation/assembly.ts'
export { ConversationController, UnsupportedImageMediaTypeError } from './service.ts'
export type { IConversation } from './service.ts'
export type {
  CallId, ConversationStoreState, ConversationViewRequest,
  SelectionTarget, ViewCompanion, ViewTab,
} from './contract/views.ts'
export type { ConversationKey } from './locales.ts'
export type {
  AssistantChatData, ChatNode, ChatNodeDataMap, ChatNodeKind, ManualCompactionChatData,
  RetryChatData, ToolChatData, TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
export type {
  ConversationContextReader, ConversationLocation,
  ConversationLocationData, ConversationLocationDataScope, ConversationLocationDataSource,
  ConversationLocationDataStore,
  ConversationMatch, ConversationMatchResult, ConversationNodeContext,
  ConversationNodeDefinition, ConversationPreviousContext, ConversationPublication,
  ConversationStartMatch,
  ConversationStepDataMap, ConversationTimelineSnapshot, ConversationTurnDataMap,
  ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
  ConversationViewSnapshotMap, ConversationViewSnapshotStore, StepLocation, TurnLocation,
} from './contract/conversation.ts'
export { EMPTY_CONVERSATION_SNAPSHOT, conversationPhase } from './contract/snapshot.ts'
export type {
  ConversationPhase, ConversationSnapshot,
} from './contract/snapshot.ts'
export type {
  AssistantBlock, AssistantMessageNode, AssistantProvenanceView, AssistantRequestConfig,
  AssistantTiming, CommandNode, CompactionSummaryNode, ContextMessageNode, ConversationNode,
  ModelRetryNode, PartialAssistant, RunningToolCall, SteeringMessageNode, TodoItem,
  ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode, UnknownSurfaceNode,
  UserMessageNode,
} from './contract/records.ts'
export type {
  ContextProvenanceView, ContextRole, KnownContextForm,
} from './contract/context-provenance.ts'
export type {
  ConversationPromptSnapshot, RequestInspectionSnapshot, RequestPromptChange, RequestPromptInspection, RequestPromptInspector, RequestView,
} from './contract/request-inspection.ts'
export { inspectRequestPrompt } from './contract/request-inspection.ts'

export { ConversationNodeAssembler } from './conversation/assembler.ts'
export type {
  ConversationEventDefinitions, ConversationViewDefinitions,
} from './conversation/assembler.ts'
export { ConversationDefinitionRegistry } from './conversation/definition-registry.ts'
export { ConversationEventRegistry } from './conversation/event-registry.ts'
export { ConversationLocationIndex } from './conversation/location-index.ts'
export type { ConversationLocationDataChange } from './conversation/location-index.ts'

export type { ConversationKey as ConversationKeyAlias } from './locales.ts'
export type {
  ComposerBarInjected,
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps, ComposerBarOwnerProps, ComposerBarProps,
  ComposerChainProps, ConversationInjected,
  ConversationHeaderActionOwnerProps, ConversationHeaderLineageOwnerProps, ConversationSessionHeaderInjected,
  ConversationSessionInjected, ConversationSessionSlotProps,
  ConversationSlotProps, ConversationStore, ConversationViews, ConvViewOwnerProps,
  ConvViewProps, EmptyWorkspaceOwnerProps, HeroAgentPresetOwnerProps,
  HeroBrandMarkOwnerProps,
  InputControlOwnerProps, InputZone,
  MessageImageLoader, MessageImageSource, MessageImagesOwnerProps, RenderMessageImages,
  UseConversation, UseConversationViews,
} from './contract/slots.ts'
export type {
  ChatFileMentions, ChatNodeOwnerProps, ChatNodeViewProps,
  ChatStore, ChatStoreState, ChatViewInjected, ChatViewSlotProps, CommandRowOwnerProps, CommandRowProps,
  DetailsInjected, DetailsSlotProps, DetailsToolOwnerProps, MessageImagesProps,
  TurnTailOwnerProps, UseChatNodeTurnData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
export type {
  ArbitrateKey, ArbitrateOutcome, BeginCommandRequest, CommandClaim, ConsumeTokenRequest,
  DraftAttachmentId, InputActions, InputState, InsertReferenceRequest, InsertTextRequest,
  PickOutcome, ReferenceInsert, SessionInput, SessionInputResolver, SubmitImageAttachment,
  SubmitOutcome, TokenSpan,
} from './contract/input.ts'
export type { ComposerBlock, ComposerBlocks } from './contract/composer-blocks.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Scope-addressed Conversation actions and per-Session input registry. */
    conversation: import('./service.ts').IConversation
    /** Target-neutral Conversation registries and per-Session assembly. */
    uiConversation: import('./conversation/assembly.ts').UiConversation
  }
}
