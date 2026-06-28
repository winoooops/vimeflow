import { useCallback, useState } from 'react'

export interface NewSessionDialogState {
  open: boolean
  defaultCwd: string
  openWith: (cwd: string | undefined) => void
  setOpen: (open: boolean) => void
}

export const useNewSessionDialog = (): NewSessionDialogState => {
  const [open, setOpen] = useState(false)
  const [defaultCwd, setDefaultCwd] = useState('~')

  const openWith = useCallback((cwd: string | undefined): void => {
    setDefaultCwd(cwd ?? '~')
    setOpen(true)
  }, [])

  return { open, defaultCwd, openWith, setOpen }
}
