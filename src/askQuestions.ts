import * as vscode from "vscode";

export async function askQuestions(questions: any[]): Promise<{ [key: string]: any }> {
  const answers: { [key: string]: any } = {};

  for (const question of questions) {
    let response: string | undefined;

    if (question.type === "list" && question.choices) {
      response = await vscode.window.showQuickPick(question.choices, {
        placeHolder: question.message,
      });
    } else {
      response = await vscode.window.showInputBox({
        prompt: question.message,
        value: question.default || '',
        placeHolder: question.message,
      });
    }

    if (response === undefined) {
      return {};
    }

    answers[question.name] = response;
  }

  return answers;
}
