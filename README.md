# Text Completion Reasoning Profile Extension

## How to Install

Use this URL in SillyTavern's extension installer:

```plaintext
https://github.com/RossAscends/ST-TCReasoningProfile/
```

## Concept

This extension draws inspiration from [Stepped Thinking](https://github.com/cierru/st-stepped-thinking) by Cierru, but is written to integrate closely with SillyTavern's native Reasoning Auto-Parse functionality while also utlizing Connection Profiles for more customization.

### Advantages over Stepping Thinking

- Reasoning and Response are contained within the same message and follow ST's native message saving conventions.
- Following from above, all native functions for Reasoning manipulation are possible.
- No new UI to learn for prompt adjustments; just setup Connection Profiles as you normally would.
- Can use different APIs for each step, leveraging their individual strengths.

### Assumptions

- Not all models are trained to Reason, but they *do* all have an innate 'Assistant Lizard Brain' we can leverage to simulate reasoning.
- Models that *are* trained to Reasoning tend to spend a lot of time & tokens in their Reasoning process, and we want to control this.
- Models follow complex instructions much more precisely when Temperature is low (0.5 to 0.8).
- Models write more interesting and novel roleplay content when Temperature is high (1.0 to 1.5+, mitigated by minP 0.01 to 0.03).
- The primary use case is local inference with a 12B+ model on a Text Completion API like Tabby, YALS, or KCPP.

### Intended Strategy

- Split the generation into two independent steps: Reasoning and Response.
- Each step functions under its own bespoke Connection Profile.
- When a generation request is sent, the Extension swaps to the Reasoning profile first, gets the Reasoning, and then swaps back to the Response profile to complete the request.
- `Reasoning Step` has low temp, a response length of your liking, and should not produce any response after the Reasoning is finished.
  - **EXCEPTION**: Asking the model produce a minimal 'finished signal' (ex: `CoT Done`) outside the Reasoning tags can be a useful failsafe. This is explained more below.
- `Response Step` is higher temp, clears any leftover non-Reasoning content, and uses the Reasoning to inform itself.


### Limitations

- Since you are effectively making two separate API requests, it may take longer if your backend is slow with Prompt Processing.
  - In my testing (RTX3060 12GB VRAM running a 24B 2.5bpw EXL3 model in Tabby at 8k Q8 context) I found a full response of 500 reasoning tokens and 1000 response tokens took about 60-80 seconds. However this was pushing my card to the limit. Models that properly fit your GPU will be significantly faster.
- You have to setup the Connection Profiles on your own.
- Will probably break if you try to use it alongside Stepped Thinking or any other Extension/Quick Reply that interferes with ST's native message processing functions.
- You must remember to save any presets that are a part of your connection profiles if you do any Sampler or Prompt adjustments.
- You must remember to save the Connection Profile itself if you swap any of the presets associated with it.
- It probably won't work on Chat Completion APIs, but there are better, usually native, tools for managing Reasoning on those APIs/models already.

## Post-install Setup

### Requirements

- Connection Manager extension
- `Reasoning Auto Parse` configured in ST's Advanced Formatting panel
- At least 2 Connection Profiles

### Extension Settings

- **Power button** - located in the Extension Settings header, this simply toggles the active state of the entire extension.
- **Reasoning Profile** - this is the profile that will be used in the Reasoning Step.
- **Post-Reasoning auto-Continued Response Prefix** textarea - The message about to be continued upon will be prefixed with this. By default the extension will add `\n ` (newline and a space), but you can set this to anything you like. This prefix helps assure the model will attempt to Continue correctly and not simply assume the response is complete and thus return `<EOS>` or something similar.
- **Continue After Reasoning Finishes** checkbox - makes the extension do the following after Reasoning Step:
  - Swap back to the primary Response Profile
  - Clear any extra content outside the `<reasoning>` section
  - Add the header prefix to help assure the model will continue successfully
  - Finally, initiate a Continue to get the Response portion

### Profile Setup

#### Reasoning Connection Profile

This should be designed to get the model to do a chain of thought inside tags that match your Reasoning prefix/suffix settings in ST's Advanced Formatting panel. I have found that models tend to dislike doing this cleanly, so it may be helpful to prompt it to include a single word after the reasoning tag has closed to signify it has are finished. Without such a 'final word outside of the think tag', the model will often forget to close the think tag.

**Sample Reasoning Profile Settings:**

```plaintext
- Samplers Panel -
Temp: 0.5
MinP: 0.01
Response Length: 500 tokens

- Advanced Formatting Panel -
Reasoning AutoParse: ENABLED
Reasoning Prefix: <think>\n
Reason Suffix: \n</think>
Prefix reply with: <think>\n
```

**NOTE:** The `prefix reply with` setting is unnecessary if your model naturally produces Reasoning tags on its own.

**Sample Reasoning Profile System Prompt:**

```plaintext
Do not roleplay as {{char}} in the next response. 
Instead, provide a concise out-of-character Chain of Thought (CoT) in the form of a bullet list.
The CoT should illustrate {{char}}'s thoughts regarding the story so far and {{user}}'s latest input. 
Format the CoT exactly as shown below without deviation:

---
<think>

- Concise thoughts in a bullet list.
- Concise personality traits in a bullet list.
- Concise background information in a bullet list.

</think>
---

Your response will be invalid if you do not write </think> at the end.
After closing the 'think' XML tag, simply write "CoT Done" and end your response IMMEDIATELY.
Do not respond in-character as {{char}} after the CoT.
Instructions, background information, and story details follow below:
```

**NOTE:** The purpose of asking the model to write `CoT Done` outside the `<think>` tag is to assure the model actually closes the tag before ending the token stream.  However, not all models will require this kind of a crutch (but 24B Mistrall-Small-3.2-2506 *did*, because it's not a Reasoning model). The `CoT Done` text will be removed in the next step and replaced with the content of the Extension's `Post-Reasoning auto-Continued Response Prefix` textarea before the next prompt is sent to the model to ask for the Response content.

#### Response Connection Profile

**NOTE:** Whatever Profile is active when you send the API request will be used in the Response Step!

**Sample Response Profile Settings:**

```plaintext
Temp 1.5
MinP 0.015
Response Length 1000 tokens
```

**Sample Response Profile System Prompt:**

This can be anything, but I find it helps to adjust the system prompt to ask the model to `continue with a response based on the Reasoning contents` or something of that sort.

```plaintext
Continue in-character as {{char}} to provide a final response that is informed by and integrates the concepts detailed inside the <think> tag. 
Do not directly mention or quote verbatim the contents inside the <think> tag.
```

## License

AGPLv3
