import * as React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { sessionAllow } from '@/sync/ops';
import { t } from '@/text';
import { Ionicons } from '@expo/vector-icons';

interface QuestionOption {
    label: string;
    description: string;
}

interface Question {
    id?: string;
    allowFreeText?: boolean;
    selection?: { minSelections?: number; maxSelections?: number };
    question: string;
    header: string;
    options: QuestionOption[];
    multiSelect: boolean;
}

interface AskUserQuestionInput {
    questions: Question[];
}

// Styles MUST be defined outside the component to prevent infinite re-renders
// with react-native-unistyles. The theme is passed as a function parameter.
const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 16,
    },
    questionSection: {
        gap: 8,
    },
    headerChip: {
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        marginBottom: 4,
    },
    headerText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
    },
    questionText: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 8,
    },
    optionsContainer: {
        gap: 4,
    },
    optionButton: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: theme.colors.divider,
        gap: 10,
        minHeight: 44, // Minimum touch target for mobile
    },
    optionButtonSelected: {
        backgroundColor: theme.colors.surfaceHigh,
        borderColor: theme.colors.radio.active,
    },
    optionButtonDisabled: {
        opacity: 0.6,
    },
    radioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    radioOuterSelected: {
        borderColor: theme.colors.radio.active,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.radio.dot,
    },
    checkboxOuter: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    checkboxOuterSelected: {
        borderColor: theme.colors.radio.active,
        backgroundColor: theme.colors.radio.active,
    },
    optionContent: {
        flex: 1,
    },
    optionLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
    },
    optionDescription: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    actionsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
        justifyContent: 'flex-end',
    },
    submitButton: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44, // Minimum touch target for mobile
    },
    submitButtonDisabled: {
        opacity: 0.5,
    },
    submitButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 14,
        fontWeight: '600',
    },
    submittedContainer: {
        gap: 8,
    },
    submittedItem: {
        flexDirection: 'row',
        gap: 8,
    },
    submittedHeader: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    submittedValue: {
        fontSize: 13,
        color: theme.colors.text,
        flex: 1,
    },
}));

export const AskUserQuestionView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const { theme } = useUnistyles();
    const [selections, setSelections] = React.useState<Map<number, Set<number>>>(new Map());
    const [freeText, setFreeText] = React.useState<Record<number, string>>({});
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [isSubmitted, setIsSubmitted] = React.useState(false);

    // Parse input
    const input = tool.input as AskUserQuestionInput | undefined;
    const questions = input?.questions;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return null;
    }

    const isRunning = tool.state === 'running';
    const canInteract = isRunning && !isSubmitted;

    // Check if all questions have at least one selection
    const allQuestionsAnswered = questions.every((q, qIndex) => {
        if (q.allowFreeText && freeText[qIndex]?.trim()) return true;
        const selected = selections.get(qIndex);
        return selected && selected.size >= (q.selection?.minSelections ?? 1) && selected.size <= (q.selection?.maxSelections ?? Infinity);
    });

    const handleOptionToggle = React.useCallback((questionIndex: number, optionIndex: number, multiSelect: boolean) => {
        if (!canInteract) return;
        setFreeText(previous => ({ ...previous, [questionIndex]: '' }));

        setSelections(prev => {
            const newMap = new Map(prev);
            const currentSet = newMap.get(questionIndex) || new Set();

            if (multiSelect) {
                // Toggle for multi-select
                const newSet = new Set(currentSet);
                if (newSet.has(optionIndex)) {
                    newSet.delete(optionIndex);
                } else {
                    newSet.add(optionIndex);
                }
                newMap.set(questionIndex, newSet);
            } else {
                // Replace for single-select
                newMap.set(questionIndex, new Set([optionIndex]));
            }

            return newMap;
        });
    }, [canInteract]);

    const handleSubmit = React.useCallback(async () => {
        if (!sessionId || !allQuestionsAnswered || isSubmitting) return;

        setIsSubmitting(true);

        // HACK: Disable the form immediately by switching to the submitted view.
        // Without this, users could edit their selections while the network calls
        // are in flight, but those edits would be ignored since we've already
        // captured the values above. TODO: Revisit this logic.
        setIsSubmitted(true);

        const answers: Record<string, string> = {};
        questions.forEach((q, qIndex) => {
            const selected = selections.get(qIndex);
            if (selected && selected.size > 0) {
                const selectedLabels = Array.from(selected)
                    .map(optIndex => q.options[optIndex]?.label)
                    .filter(Boolean)
                    .join(', ');
                answers[q.question] = selectedLabels;
            }
            if (q.allowFreeText && freeText[qIndex]?.trim()) {
                answers[q.question] = freeText[qIndex].trim();
            }
        });

        try {
            // AskUserQuestion expects answers to be returned as part of the tool input,
            // not as a follow-up plain text message.
            if (tool.permission?.id) {
                const selectedLabels = questions.some(q => q.id)
                    ? Object.fromEntries(questions.map((q, i) => [q.question, freeText[i]?.trim()
                        ? null : Array.from(selections.get(i) ?? []).map(index => q.options[index].label)]))
                    : undefined;
                await sessionAllow(sessionId, tool.permission.id, undefined, undefined, 'approved', {
                    answers, ...(selectedLabels ? { selectedLabels } : {}),
                });
            }
        } catch (error) {
            console.error('Failed to submit answer:', error);
        } finally {
            setIsSubmitting(false);
        }
    }, [sessionId, questions, selections, freeText, allQuestionsAnswered, isSubmitting, tool.permission?.id]);

    // Show submitted state
    if (isSubmitted || tool.state === 'completed') {
        return (
            <ToolSectionView>
                <View style={styles.submittedContainer}>
                    {questions.map((q, qIndex) => {
                        const selected = selections.get(qIndex);
                        const selectedLabels = freeText[qIndex]?.trim() || (selected
                            ? Array.from(selected)
                                .map(optIndex => q.options[optIndex]?.label)
                                .filter(Boolean)
                                .join(', ')
                            : '-');
                        return (
                            <View key={qIndex} style={styles.submittedItem}>
                                <Text style={styles.submittedHeader}>{q.header}:</Text>
                                <Text style={styles.submittedValue}>{selectedLabels}</Text>
                            </View>
                        );
                    })}
                </View>
            </ToolSectionView>
        );
    }

    return (
        <ToolSectionView>
            <View style={styles.container}>
                {questions.map((question, qIndex) => {
                    const selectedOptions = selections.get(qIndex) || new Set();

                    return (
                        <View key={qIndex} style={styles.questionSection}>
                            <View style={styles.headerChip}>
                                <Text style={styles.headerText}>{question.header}</Text>
                            </View>
                            <Text style={styles.questionText}>{question.question}</Text>
                            {question.allowFreeText && <TextInput
                                accessibilityLabel={`Answer: ${question.question}`}
                                placeholder="Type an answer"
                                placeholderTextColor={theme.colors.textSecondary}
                                value={freeText[qIndex] ?? ''}
                                maxLength={500}
                                editable={canInteract}
                                onChangeText={value => setFreeText(previous => ({ ...previous, [qIndex]: value }))}
                                style={{ color: theme.colors.text, padding: 12, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 8 }}
                            />}
                            <View style={styles.optionsContainer}>
                                {question.options.map((option, oIndex) => {
                                    const isSelected = selectedOptions.has(oIndex);

                                    return (
                                        <TouchableOpacity
                                            key={oIndex}
                                            style={[
                                                styles.optionButton,
                                                isSelected && styles.optionButtonSelected,
                                                !canInteract && styles.optionButtonDisabled,
                                            ]}
                                            onPress={() => handleOptionToggle(qIndex, oIndex, question.multiSelect)}
                                            disabled={!canInteract}
                                            activeOpacity={0.7}
                                        >
                                            {question.multiSelect ? (
                                                <View style={[
                                                    styles.checkboxOuter,
                                                    isSelected && styles.checkboxOuterSelected,
                                                ]}>
                                                    {isSelected && (
                                                        <Ionicons name="checkmark" size={14} color="#fff" />
                                                    )}
                                                </View>
                                            ) : (
                                                <View style={[
                                                    styles.radioOuter,
                                                    isSelected && styles.radioOuterSelected,
                                                ]}>
                                                    {isSelected && <View style={styles.radioInner} />}
                                                </View>
                                            )}
                                            <View style={styles.optionContent}>
                                                <Text style={styles.optionLabel}>{option.label}</Text>
                                                {option.description && (
                                                    <Text style={styles.optionDescription}>{option.description}</Text>
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}

                {canInteract && (
                    <View style={styles.actionsContainer}>
                        <TouchableOpacity
                            style={[
                                styles.submitButton,
                                (!allQuestionsAnswered || isSubmitting) && styles.submitButtonDisabled,
                            ]}
                            onPress={handleSubmit}
                            disabled={!allQuestionsAnswered || isSubmitting}
                            activeOpacity={0.7}
                        >
                            {isSubmitting ? (
                                <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                            ) : (
                                <Text style={styles.submitButtonText}>{t('tools.askUserQuestion.submit')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </ToolSectionView>
    );
});
