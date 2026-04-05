import type { Command } from './types'

/**
 * Build a command tree from an array of commands.
 * No-op for now, as commands are already in tree structure.
 */
export const buildTree = (commands: Command[]): Command[] => commands

/**
 * Merge multiple command trees into a single tree.
 * Combines arrays of root-level commands from different features.
 */
export const mergeTrees = (...trees: Command[][]): Command[] => trees.flat()

/**
 * Traverse into a namespace (command with children) and return its children.
 * Returns null if the command is a leaf (no children) or doesn't exist.
 */
export const traverseNamespace = (
  command: Command | null
): Command[] | null => {
  if (!command?.children) {
    return null
  }

  return command.children
}

/**
 * Find a command by ID in a command tree.
 * Searches recursively through the tree structure.
 */
export const findCommandById = (
  commands: Command[],
  id: string
): Command | null => {
  for (const command of commands) {
    if (command.id === id) {
      return command
    }
    if (command.children) {
      const found = findCommandById(command.children, id)
      if (found) {
        return found
      }
    }
  }

  return null
}

/**
 * Find a leaf command (command with execute handler) by ID.
 * Returns null if the command is a namespace or doesn't exist.
 */
export const findLeaf = (commands: Command[], id: string): Command | null => {
  const command = findCommandById(commands, id)
  if (!command) {
    return null
  }
  // A leaf command has an execute handler and no children
  if (command.execute && !command.children) {
    return command
  }

  return null
}

/**
 * Get all leaf commands (executable commands) from a tree.
 * Flattens the tree and filters for commands with execute handlers.
 */
export const getAllLeaves = (commands: Command[]): Command[] => {
  const leaves: Command[] = []

  const traverse = (cmds: Command[]): void => {
    for (const cmd of cmds) {
      if (cmd.execute && !cmd.children) {
        leaves.push(cmd)
      }
      if (cmd.children) {
        traverse(cmd.children)
      }
    }
  }

  traverse(commands)

  return leaves
}
