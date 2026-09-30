import React, { forwardRef, useState, useEffect, useMemo } from 'react';
import { Tv, TrendingUp, Sparkles } from 'lucide-react';
import { type CtvPublisherRecommendation } from '../types';
import { PlanText } from './PlanText';
import { type CtvPublisherSetting, getPublisherLogo } from '../planning/knowledge/ctvPublishers';

export interface CtvSlideExportViewProps {
  publishers: CtvPublisherRecommendation[];
  publisherInsights?: string;
  customPublishers?: CtvPublisherSetting[];
  maxCharacters?: number;
  maxWords?: number;
  layoutVariant?: 'detailed' | 'basic';
}

export const CtvSlideExportView = forwardRef<HTMLDivElement, CtvSlideExportViewProps>(
  (
    {
      publishers,
      publisherInsights,
      customPublishers,
      maxCharacters = 450,
      maxWords = 65,
      layoutVariant = 'detailed',
    },
    ref
  ) => {
    const isBasic = layoutVariant === 'basic';
    const totalCount = publishers.length;
    // In basic mode, show 10 cards in a 2-column grid (5 rows x 2 columns). In detailed mode, show 9 cards in a 3x3 grid.
    const maxCards = isBasic ? 10 : 9;
    const displayedPublishers = publishers.slice(0, maxCards);
    const overflowCount = totalCount > maxCards ? totalCount - maxCards : 0;

    const rawText = (publisherInsights || '').trim();
    const [aiSummarizedText, setAiSummarizedText] = useState<string | null>(null);

    // Basic export has a more spacious right column; allow up to 110 words and 780 characters so it fills comfortably
    const effectiveMaxCharacters = isBasic ? 780 : maxCharacters;
    const effectiveMaxWords = isBasic ? 110 : maxWords;

    // If publisher alignment text is too long, call AI to summarize it
    useEffect(() => {
      if (!rawText) {
        setAiSummarizedText(null);
        return;
      }

      const wordCount = rawText.split(/\s+/).length;
      if (rawText.length > effectiveMaxCharacters || wordCount > effectiveMaxWords) {
        let active = true;
        fetch('/api/summarize-publisher-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: rawText,
            maxWords: effectiveMaxWords,
            maxCharacters: effectiveMaxCharacters,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (active && data.summary) {
              setAiSummarizedText(data.summary);
            }
          })
          .catch((err) => {
            console.warn('Failed to summarize publisher insights via AI:', err);
          });

        return () => {
          active = false;
        };
      } else {
        setAiSummarizedText(null);
      }
    }, [rawText, effectiveMaxCharacters, effectiveMaxWords]);

    // The AI summary when one exists, otherwise the full text. No clipped-sentence fallback: the
    // exporter refuses to capture an over-long insight it could not summarize, so a truncated
    // paragraph never ships as if it were the finished insight.
    const displayText = useMemo(
      () => aiSummarizedText || rawText || 'Publisher insights were not generated for this plan.',
      [rawText, aiSummarizedText],
    );

    return (
      <div
        ref={ref}
        id={`ctv-slide-export-canvas-${layoutVariant}`}
        style={{
          width: '1920px',
          height: '1080px',
          backgroundColor: isBasic ? '#ffffff' : '#f8fafc',
          padding: isBasic ? '60px 72px' : '60px 68px',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          WebkitFontSmoothing: 'antialiased',
          boxSizing: 'border-box',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', gap: isBasic ? '64px' : '36px', height: '100%', width: '100%' }}>
          {/* LEFT SECTION: RECOMMENDED CTV PUBLISHERS */}
          <div
            style={{
              width: isBasic ? '1040px' : undefined,
              flex: isBasic ? 'none' : '1.8',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              height: '100%',
              minWidth: 0,
            }}
          >
            {/* Top Label with TV Icon */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: isBasic ? '26px' : '22px',
                flexShrink: 0,
              }}
            >
              <Tv style={{ width: '24px', height: '24px', color: '#4f46e5', marginRight: '12px' }} />
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: '700',
                  color: '#4f46e5',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                RECOMMENDED CTV PUBLISHERS
              </span>
            </div>

            {/* Publisher Cards Grid */}
            {displayedPublishers.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px',
                  textAlign: 'center',
                  backgroundColor: '#ffffff',
                  borderRadius: '20px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <Tv style={{ width: '52px', height: '52px', color: '#cbd5e1', marginBottom: '16px' }} />
                <p style={{ fontSize: '20px', fontWeight: '700', color: '#334155' }}>
                  No CTV publishers selected
                </p>
                <p style={{ fontSize: '15px', color: '#64748b', marginTop: '6px' }}>
                  Select publishers from the catalog to populate this slide.
                </p>
              </div>
            ) : isBasic ? (
              /* BASIC EXPORT: 2-Column Clean Grid of 10 Cards Matching Mockup (image.png) */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gridTemplateRows: 'repeat(5, 146px)',
                  columnGap: '24px',
                  rowGap: '20px',
                  flex: 1,
                  alignContent: 'start',
                }}
              >
                {displayedPublishers.map((pub, idx) => {
                  const customPub = customPublishers?.find(
                    (p) => p.name.toLowerCase() === pub.publisher.toLowerCase()
                  );
                  const logoUrl = getPublisherLogo(pub.publisher, customPub?.logoUrl);

                  return (
                    <div
                      key={`${pub.publisher}-${idx}`}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '24px',
                        border: '1.5px solid #e2e8f0',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                        padding: '0 32px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '24px',
                        height: '146px',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Circular Logo Container */}
                      <div
                        style={{
                          width: '74px',
                          height: '74px',
                          borderRadius: '9999px',
                          backgroundColor: '#ffffff',
                          border: '1.5px solid #f1f5f9',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          padding: '6px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <img
                          src={logoUrl}
                          alt={pub.publisher}
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain',
                            display: 'block',
                            borderRadius: '9999px',
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/assets/pub-logos/placeholder_80x80.png';
                          }}
                        />
                      </div>

                      {/* Publisher Name in Bold Typography - No overflow:hidden to prevent any clipping */}
                      <div
                        style={{
                          fontSize: '26px',
                          fontWeight: '700',
                          color: '#0f172a',
                          letterSpacing: '-0.01em',
                          lineHeight: '1.35',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '2px 0',
                        }}
                      >
                        {pub.publisher}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* DETAILED EXPORT: 3-Column Rich Bento Grid */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '22px',
                  flex: 1,
                  alignContent: 'start',
                }}
              >
                {displayedPublishers.map((pub, idx) => {
                  const customPub = customPublishers?.find(
                    (p) => p.name.toLowerCase() === pub.publisher.toLowerCase()
                  );
                  const logoUrl = getPublisherLogo(pub.publisher, customPub?.logoUrl);

                  return (
                    <div
                      key={`${pub.publisher}-${idx}`}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '20px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                        padding: '24px 26px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-start',
                        height: '268px',
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Card Header: Real Logo Image + Publisher Name */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          marginBottom: '16px',
                          flexShrink: 0,
                        }}
                      >
                        {/* Real Logo Image Container */}
                        <div
                          style={{
                            width: '52px',
                            height: '52px',
                            borderRadius: '12px',
                            backgroundColor: '#ffffff',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            marginRight: '16px',
                            padding: '4px',
                            boxSizing: 'border-box',
                            overflow: 'hidden',
                          }}
                        >
                          <img
                            src={logoUrl}
                            alt={pub.publisher}
                            crossOrigin="anonymous"
                            referrerPolicy="no-referrer"
                            style={{
                              maxWidth: '100%',
                              maxHeight: '100%',
                              width: 'auto',
                              height: 'auto',
                              objectFit: 'contain',
                              display: 'block',
                              borderRadius: '8px',
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/assets/pub-logos/placeholder_80x80.png';
                            }}
                          />
                        </div>

                        {/* Publisher Name */}
                        <div
                          style={{
                            fontSize: '23px',
                            fontWeight: '700',
                            color: '#0f172a',
                            lineHeight: '1.25',
                            letterSpacing: '-0.01em',
                            display: 'block',
                          }}
                        >
                          {pub.publisher}
                        </div>
                      </div>

                      {/* Card Rationale */}
                      {pub.why && (
                        <p
                          style={{
                            fontSize: '16.5px',
                            lineHeight: '1.65',
                            color: '#334155',
                            fontWeight: '400',
                            margin: 0,
                          }}
                        >
                          {pub.why}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom Indicator for Additional Publishers: Clean subtle text, no white background or border */}
            {overflowCount > 0 && (
              <div
                style={{
                  marginTop: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: '15px',
                    fontWeight: '600',
                    color: '#64748b',
                    letterSpacing: '0.01em',
                  }}
                >
                  + {overflowCount} additional {overflowCount === 1 ? 'publisher' : 'publishers'}
                </span>
              </div>
            )}
          </div>

          {/* RIGHT SECTION: PUBLISHER INSIGHTS */}
          {isBasic ? (
            /* BASIC EXPORT: Open Right Column (No Card Wrapper), Matching image.png */
            <div
              style={{
                flex: '1',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%',
                boxSizing: 'border-box',
                minWidth: 0,
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '26px',
                    flexShrink: 0,
                  }}
                >
                  <TrendingUp style={{ width: '24px', height: '24px', color: '#4f46e5', marginRight: '12px' }} />
                  <span
                    style={{
                      fontSize: '16px',
                      fontWeight: '700',
                      color: '#4f46e5',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    PUBLISHER INSIGHTS
                  </span>
                </div>

                <h3
                  style={{
                    fontSize: '38px',
                    fontWeight: '800',
                    color: '#0f172a',
                    letterSpacing: '-0.025em',
                    lineHeight: '1.2',
                    marginBottom: '24px',
                    marginTop: 0,
                  }}
                >
                  Publisher Alignment
                </h3>

                <PlanText
                  text={displayText}
                  style={{
                    fontSize: '21px',
                    lineHeight: '1.8',
                    color: '#334155',
                    fontWeight: '400',
                    margin: 0,
                  }}
                />
              </div>

            </div>
          ) : (
            /* DETAILED EXPORT: Enclosed White Bento Card */
            <div
              style={{
                width: '560px',
                flexShrink: 0,
                backgroundColor: '#ffffff',
                borderRadius: '24px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                padding: '44px 44px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%',
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}
            >
              {/* Top Area: Header + Heading + Summarized Rationale Paragraph */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}
                >
                  <TrendingUp style={{ width: '24px', height: '24px', color: '#4f46e5', marginRight: '12px' }} />
                  <span
                    style={{
                      fontSize: '15px',
                      fontWeight: '700',
                      color: '#4f46e5',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    PUBLISHER INSIGHTS
                  </span>
                </div>

                <h3
                  style={{
                    fontSize: '30px',
                    fontWeight: '800',
                    color: '#0f172a',
                    letterSpacing: '-0.02em',
                    marginTop: '6px',
                    marginBottom: '26px',
                  }}
                >
                  Publisher Alignment
                </h3>

                <PlanText
                  text={displayText}
                  style={{
                    fontSize: '18px',
                    lineHeight: '1.75',
                    color: '#334155',
                    fontWeight: '400',
                    margin: 0,
                  }}
                />
              </div>

            </div>
          )}
        </div>
      </div>
    );
  }
);

CtvSlideExportView.displayName = 'CtvSlideExportView';
