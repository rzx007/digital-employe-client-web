import { useCallback, useState, useMemo } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import {
  TextNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
} from "lexical"
import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@workspace/ui/lib/utils"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  IconGlobe,
  IconBolt,
  IconTerminal,
  IconFileText,
  IconCode,
} from "@tabler/icons-react"
import { $createCommandPillNode } from "./command-pill-node"

class SlashCommandOption extends MenuOption {
  id: string
  title: string
  icon: React.ReactElement
  description: string
  keywords: Array<string>
  onSelect: (queryString: string) => void

  constructor(
    title: string,
    options: {
      id: string
      icon: React.ReactElement
      description: string
      keywords: Array<string>
      onSelect: (queryString: string) => void
    }
  ) {
    super(title)
    this.id = options.id
    this.title = title
    this.icon = options.icon
    this.description = options.description
    this.keywords = options.keywords
    this.onSelect = options.onSelect.bind(this)
  }
}

function FloatingMenu({
  anchorElementRef,
  options,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
}: {
  anchorElementRef: React.MutableRefObject<HTMLElement | null>
  options: SlashCommandOption[]
  selectedIndex: number | null
  selectOptionAndCleanUp: (option: SlashCommandOption) => void
  setHighlightedIndex: (index: number) => void
}) {
  const [rect, setRect] = useState<{
    top: number
    left: number
    bottom: number
  } | null>(null)

  React.useEffect(() => {
    // Adding a small delay helps to get the correct bounding box
    // after Lexical finishes its selection rendering.
    const timeoutId = setTimeout(() => {
      if (anchorElementRef.current) {
        const { top, left, bottom } =
          anchorElementRef.current.getBoundingClientRect()
        setRect({ top, left, bottom })
      }
    }, 10)
    return () => clearTimeout(timeoutId)
  }, [anchorElementRef, options.length]) // Recalculate when anchor changes or options change

  if (!rect || options.length === 0) {
    return null
  }

  // Calculate position avoiding screen overflow
  const isBottomOverflow = rect.bottom + 300 > window.innerHeight
  const topPosition = isBottomOverflow
    ? rect.top - 4 // We will use transform translateY(-100%) to push it up
    : rect.bottom + 4

  return createPortal(
    <div
      className="z-50 max-w-2xl animate-in overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md fade-in-0 zoom-in-95"
      style={{
        position: "fixed",
        top: topPosition,
        left: rect.left,
        maxHeight: "300px",
        overflowY: "auto",
        transform: isBottomOverflow ? "translateY(-100%)" : "none",
      }}
    >
      <Command>
        <CommandList>
          <CommandGroup heading="Commands">
            {options.map((option, i) => (
              <CommandItem
                key={option.key}
                onSelect={() => {
                  setHighlightedIndex(i)
                  selectOptionAndCleanUp(option)
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm p-2 hover:bg-accent hover:text-accent-foreground",
                  selectedIndex === i && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => {
                  setHighlightedIndex(i)
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                }}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                  {option.icon}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm leading-none font-medium">
                    {option.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>,
    document.body
  )
}

export function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
  })

  const getOptions = useCallback(() => {
    const options = [
      new SlashCommandOption("Web Search", {
        id: "web-search",
        icon: <IconGlobe className="h-4 w-4" />,
        description: "Search the web for information",
        keywords: ["web", "search", "google", "network"],
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.insertNodes([
                $createCommandPillNode("web-search", "Web Search"),
                $createTextNode(" "),
              ])
            }
          })
        },
      }),
      new SlashCommandOption("Agent", {
        id: "agent",
        icon: <IconBolt className="h-4 w-4" />,
        description: "Call a specific Agent",
        keywords: ["agent", "ai", "bot"],
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.insertNodes([
                $createCommandPillNode("agent", "Agent"),
                $createTextNode(" "),
              ])
            }
          })
        },
      }),
      new SlashCommandOption("Terminal", {
        id: "terminal",
        icon: <IconTerminal className="h-4 w-4" />,
        description: "Run a terminal command",
        keywords: ["terminal", "bash", "shell", "cmd"],
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.insertNodes([
                $createCommandPillNode("terminal", "Terminal"),
                $createTextNode(" "),
              ])
            }
          })
        },
      }),
      new SlashCommandOption("Docs", {
        id: "docs",
        icon: <IconFileText className="h-4 w-4" />,
        description: "Search documentation",
        keywords: ["docs", "documentation", "help", "guide"],
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.insertNodes([
                $createCommandPillNode("docs", "Docs"),
                $createTextNode(" "),
              ])
            }
          })
        },
      }),
      new SlashCommandOption("Code", {
        id: "code",
        icon: <IconCode className="h-4 w-4" />,
        description: "Generate or analyze code",
        keywords: ["code", "dev", "program"],
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.insertNodes([
                $createCommandPillNode("code", "Code"),
                $createTextNode(" "),
              ])
            }
          })
        },
      }),
    ]

    if (!queryString) {
      return options
    }

    const regex = new RegExp(queryString, "i")
    return options.filter(
      (option) =>
        regex.test(option.title) ||
        option.keywords.some((keyword) => regex.test(keyword))
    )
  }, [editor, queryString])

  const options = useMemo(() => getOptions(), [getOptions])

  const onSelectOption = useCallback(
    (
      selectedOption: SlashCommandOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString: string
    ) => {
      editor.update(() => {
        if (nodeToRemove) {
          nodeToRemove.remove()
        }
        selectedOption.onSelect(matchingString)
      })
      closeMenu()
    },
    [editor]
  )

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) => {
        if (anchorElementRef.current == null || options.length === 0) {
          return null
        }

        return (
          <FloatingMenu
            anchorElementRef={anchorElementRef}
            options={options}
            selectedIndex={selectedIndex}
            selectOptionAndCleanUp={selectOptionAndCleanUp}
            setHighlightedIndex={setHighlightedIndex}
          />
        )
      }}
    />
  )
}
