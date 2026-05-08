"use client"

import { useState, useEffect, useCallback, useRef } from "react"

export const CIPHER_CHARS = "!@#$%^&*()_+-=[]{}|;':,./<>?0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZαβγδεζηθικλμνξοπρστυφχψω"

export function generateScramble(s: string): string {
  return s.split("").map((c) =>
    c === " " || c === "\n" ? c : CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]
  ).join("")
}

interface UseDecryptEffectOptions {
  duration?: number
  onComplete?: () => void
}

export function useDecryptEffect(options: UseDecryptEffectOptions = {}) {
  const { duration = 1000, onComplete } = options
  const [displayValue, setDisplayValue] = useState("")
  const [isDecrypting, setIsDecrypting] = useState(false)
  const targetRef = useRef("")
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const getRandomChar = () => CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]

  const decrypt = useCallback((plaintext: string) => {
    if (!plaintext) {
      setDisplayValue("")
      return
    }

    targetRef.current = plaintext
    setIsDecrypting(true)

    setDisplayValue(
      plaintext
        .split("")
        .map((char) => (char === " " || char === "\n" ? char : getRandomChar()))
        .join("")
    )

    const totalChars = plaintext.replace(/[ \n]/g, "").length
    const revealInterval = duration / totalChars
    const scrambleInterval = 30

    const indicesToReveal = plaintext
      .split("")
      .map((char, i) => (char !== " " && char !== "\n" ? i : -1))
      .filter((i) => i !== -1)

    for (let i = indicesToReveal.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[indicesToReveal[i], indicesToReveal[j]] = [indicesToReveal[j], indicesToReveal[i]]
    }

    let revealCount = 0
    const revealed = new Set<number>()
    let currentDisplay = plaintext
      .split("")
      .map((char) => (char === " " || char === "\n" ? char : getRandomChar()))

    const scrambleTimer = setInterval(() => {
      currentDisplay = currentDisplay.map((char, i) => {
        if (plaintext[i] === " " || plaintext[i] === "\n" || revealed.has(i)) return char
        return getRandomChar()
      })
      setDisplayValue(currentDisplay.join(""))
    }, scrambleInterval)

    const revealTimer = setInterval(() => {
      if (revealCount >= indicesToReveal.length) {
        clearInterval(revealTimer)
        clearInterval(scrambleTimer)
        setDisplayValue(plaintext)
        setIsDecrypting(false)
        onCompleteRef.current?.()
        return
      }

      const indexToReveal = indicesToReveal[revealCount]
      revealed.add(indexToReveal)
      currentDisplay[indexToReveal] = plaintext[indexToReveal]
      setDisplayValue(currentDisplay.join(""))
      revealCount++
    }, revealInterval)

    return () => {
      clearInterval(scrambleTimer)
      clearInterval(revealTimer)
    }
  }, [duration])

  const reset = useCallback(() => {
    setDisplayValue("")
    setIsDecrypting(false)
    targetRef.current = ""
  }, [])

  return {
    displayValue,
    isDecrypting,
    decrypt,
    reset,
  }
}
