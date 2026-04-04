import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { DropZone } from './DropZone'

describe('DropZone', () => {
  test('renders drop zone region', () => {
    render(<DropZone targetPath="src/components/" />)

    const dropZone = screen.getByRole('region', { name: /file drop zone/i })
    expect(dropZone).toBeInTheDocument()
  })

  test('displays upload icon', () => {
    const { container } = render(<DropZone targetPath="src/components/" />)

    const icon = container.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveTextContent('upload_file')
  })

  test('displays target path in message', () => {
    render(<DropZone targetPath="src/components/" />)

    expect(
      screen.getByText(/drop files here to upload to src\/components\//i)
    ).toBeInTheDocument()
  })

  test('has dashed border styling', () => {
    render(<DropZone targetPath="src/components/" />)

    const dropZone = screen.getByRole('region', { name: /file drop zone/i })
    expect(dropZone).toHaveClass('border-2', 'border-dashed', 'border-outline-variant/30')
  })

  test('has rounded corners', () => {
    render(<DropZone targetPath="src/components/" />)

    const dropZone = screen.getByRole('region', { name: /file drop zone/i })
    expect(dropZone).toHaveClass('rounded-xl')
  })

  test('has centered content layout', () => {
    render(<DropZone targetPath="src/components/" />)

    const dropZone = screen.getByRole('region', { name: /file drop zone/i })
    expect(dropZone).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center')
  })

  test('supports different target paths', () => {
    render(<DropZone targetPath="src/utils/" />)

    expect(
      screen.getByText(/drop files here to upload to src\/utils\//i)
    ).toBeInTheDocument()
  })
})
