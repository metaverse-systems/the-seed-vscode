import * as vscode from "vscode";
import type { PromptQuestion } from "@metaverse-systems/the-seed/types";

export async function askQuestions(questions: readonly PromptQuestion[]): Promise<{ [key: string]: string }> {
  const answers: { [key: string]: string } = {};

  for (const question of questions) {
    let response: string | undefined;

    if (question.type === "list" && question.choices) {
      response = await vscode.window.showQuickPick(question.choices, {
        placeHolder: question.message,
      });
    } else {
      response = await vscode.window.showInputBox({
        prompt: question.message,
        value: question.default ?? '',
        placeHolder: question.message,
        validateInput: typeof question.validate === 'function'
          ? (value: string) => {
              const result = question.validate?.(value);
              return typeof result === 'string' ? result : undefined;
            }
          : undefined,
      });
    }

    if (response === undefined) {
      return {};
    }

    answers[question.name] = response;
  }

  return answers;
}
