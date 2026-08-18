/** Shared dialog frame and identity fields for Model Hub editors. */

import type { ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './ModelHubSection.module.css'

/** Props for the common Model Hub editor dialog. */
export interface EditorDialogProps {
  open: boolean
  title: string
  closeLabel: string
  description: string
  cancelLabel: string
  saveLabel: string
  busy: boolean
  children: ReactNode
  onClose: () => void
  onSubmit: () => void
}

/**
 * Render the shared dialog chrome used by provider and model editors.
 * @param props - dialog copy, state, content, and actions.
 * @returns the editor modal.
 */
export function EditorDialog({
  open,
  title,
  closeLabel,
  description,
  cancelLabel,
  saveLabel,
  busy,
  children,
  onClose,
  onSubmit,
}: EditorDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={closeLabel}
      description={description}
      className={styles.dialog}
      contentClassName={styles.scrollContent}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" disabled={busy} onClick={onSubmit}>{saveLabel}</Button>
        </>
      )}
    >
      {children}
    </Modal>
  )
}

/** Props for the common key/name row. */
export interface IdentityFieldsProps {
  sectionLabel: string
  identityLabel: string
  identityValue: string
  identityPlaceholder: string
  identityHint?: string
  displayNameLabel: string
  displayName: string
  readOnly: boolean
  onIdentityChange: (value: string) => void
  onDisplayNameChange: (value: string) => void
}

/**
 * Render the key and display-name row shared by both editors.
 * @param props - labels, values, editability, and change callbacks.
 * @returns the basic identity section.
 */
export function IdentityFields({
  sectionLabel,
  identityLabel,
  identityValue,
  identityPlaceholder,
  identityHint,
  displayNameLabel,
  displayName,
  readOnly,
  onIdentityChange,
  onDisplayNameChange,
}: IdentityFieldsProps) {
  return (
    <section className={styles.group}>
      <span className={styles.groupTitle}>{sectionLabel}</span>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.label}>{identityLabel}</span>
          <Input
            value={identityValue}
            onChange={(event) => { onIdentityChange(event.currentTarget.value) }}
            readOnly={readOnly}
            placeholder={identityPlaceholder}
          />
          {identityHint === undefined ? null : <span className={styles.hint}>{identityHint}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{displayNameLabel}</span>
          <Input value={displayName} onChange={(event) => { onDisplayNameChange(event.currentTarget.value) }} />
        </label>
      </div>
    </section>
  )
}
